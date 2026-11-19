package com.richiejeeves.healthconnect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val base = "https://aelsipdtezvhjkwsshqx.supabase.co"
    private val key = "sb_publishable_JbN0kUdtX6d5J8bWAPbz4w_syw2aG4K"
    private val prefs by lazy {
        val master = MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(applicationContext, "jeeves_auth", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val token = validToken()
            val queue = JSONArray(request("GET", "$base/rest/v1/health_sync_requests?select=id&status=eq.queued&order=requested_at.asc&limit=1", null, token))
            if (queue.length() == 0) return@withContext Result.success()
            val id = queue.getJSONObject(0).getString("id")
            val itemUrl = "$base/rest/v1/health_sync_requests?id=eq.$id"
            request("PATCH", itemUrl, JSONObject().put("status", "processing").put("started_at", Instant.now().toString()), token)

            try {
                val client = HealthConnectClient.getOrCreate(applicationContext)
                val granted = client.permissionController.getGrantedPermissions()
                val required = listOf(
                    HealthPermission.getReadPermission(StepsRecord::class),
                    HealthPermission.getReadPermission(HeartRateRecord::class),
                    HealthPermission.getReadPermission(SleepSessionRecord::class),
                    HealthPermission.getReadPermission(WeightRecord::class),
                    HealthPermission.getReadPermission(BodyFatRecord::class),
                    HealthPermission.getReadPermission(BloodPressureRecord::class)
                )
                if (required.none { it in granted }) throw IllegalStateException("Health Connect permissions are not granted.")
                if (PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in granted) {
                    throw IllegalStateException("Enable Health Connect background access in Jeeves Health > Connect Health Connect.")
                }
                val records = readRecords(client, granted)
                var synced = 0
                for (start in 0 until records.length() step 100) {
                    val batch = JSONArray()
                    for (i in start until minOf(start + 100, records.length())) batch.put(records.getJSONObject(i))
                    val result = JSONObject(request("POST", "$base/functions/v1/health-sync", JSONObject().put("records", batch), token))
                    synced += result.optInt("synced")
                }
                request("PATCH", itemUrl, JSONObject().put("status", "completed")
                    .put("completed_at", Instant.now().toString()).put("error", JSONObject.NULL), token)
            } catch (error: Exception) {
                request("PATCH", itemUrl, JSONObject().put("status", "failed")
                    .put("completed_at", Instant.now().toString())
                    .put("error", (error.message ?: "Background sync failed").take(500)), token)
                return@withContext Result.failure()
            }
            Result.success()
        } catch (error: Exception) {
            if (error.message?.contains("Sign in") == true) Result.failure() else Result.retry()
        }
    }

    private fun validToken(): String {
        val current = prefs.getString("access_token", null)
        if (current != null && prefs.getLong("expires_at", 0) > System.currentTimeMillis() / 1000) return current
        val refresh = prefs.getString("refresh_token", null) ?: throw IllegalStateException("Sign in to Jeeves Health to enable background sync.")
        val json = JSONObject(request("POST", "$base/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refresh), null))
        prefs.edit().putString("access_token", json.getString("access_token"))
            .putString("refresh_token", json.getString("refresh_token"))
            .putLong("expires_at", System.currentTimeMillis() / 1000 + json.optLong("expires_in", 3600) - 60).apply()
        return json.getString("access_token")
    }

    private suspend fun readRecords(client: HealthConnectClient, granted: Set<String>): JSONArray {
        val out = JSONArray()
        val now = Instant.now()
        val since = now.minus(30, ChronoUnit.DAYS)
        val range = TimeRangeFilter.between(since, now)
        fun add(type: String, id: String, start: Instant, end: Instant, value: JSONObject, source: String?, device: String?) {
            out.put(JSONObject().put("record_type", type).put("external_id", id.ifBlank { "$type-$start" })
                .put("start_time", start.toString()).put("end_time", end.toString()).put("value", value)
                .put("source_app", source ?: JSONObject.NULL).put("source_device", device ?: JSONObject.NULL))
        }
        if (HealthPermission.getReadPermission(StepsRecord::class) in granted) {
            val start = LocalDate.now().atStartOfDay(ZoneId.systemDefault()).toInstant()
            val total = client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, now)))[StepsRecord.COUNT_TOTAL] ?: 0L
            if (total > 0) add("steps", "steps-${LocalDate.now()}", start, now, JSONObject().put("count", total), "Health Connect", null)
        }
        if (HealthPermission.getReadPermission(HeartRateRecord::class) in granted) {
            client.readRecords(ReadRecordsRequest(HeartRateRecord::class, timeRangeFilter = range, pageSize = 1000)).records.forEach { r ->
                val samples = JSONArray()
                r.samples.forEach { s -> samples.put(JSONObject().put("bpm", s.beatsPerMinute).put("time", s.time.toString())) }
                add("heart_rate", r.metadata.id, r.startTime, r.endTime, JSONObject().put("samples", samples), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) {
            client.readRecords(ReadRecordsRequest(SleepSessionRecord::class, timeRangeFilter = range, pageSize = 1000)).records.forEach { r ->
                add("sleep", r.metadata.id, r.startTime, r.endTime, JSONObject().put("duration_minutes", ChronoUnit.MINUTES.between(r.startTime, r.endTime)).put("stage_count", r.stages.size), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        if (HealthPermission.getReadPermission(WeightRecord::class) in granted) {
            client.readRecords(ReadRecordsRequest(WeightRecord::class, timeRangeFilter = range, pageSize = 1000)).records.forEach { r ->
                add("weight", r.metadata.id, r.time, r.time, JSONObject().put("kg", r.weight.inKilograms), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        if (HealthPermission.getReadPermission(BodyFatRecord::class) in granted) {
            client.readRecords(ReadRecordsRequest(BodyFatRecord::class, timeRangeFilter = range, pageSize = 1000)).records.forEach { r ->
                add("body_fat", r.metadata.id, r.time, r.time, JSONObject().put("percentage", r.percentage.value), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        if (HealthPermission.getReadPermission(BloodPressureRecord::class) in granted) {
            client.readRecords(ReadRecordsRequest(BloodPressureRecord::class, timeRangeFilter = range, pageSize = 1000)).records.forEach { r ->
                add("blood_pressure", r.metadata.id, r.time, r.time, JSONObject().put("systolic_mmhg", r.systolic.inMillimetersOfMercury)
                    .put("diastolic_mmhg", r.diastolic.inMillimetersOfMercury).put("measurement_location", r.measurementLocation),
                    r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        return out
    }

    private fun request(method: String, url: String, body: JSONObject?, bearer: String?): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 20000; readTimeout = 30000
            setRequestProperty("apikey", key); setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Prefer", "return=minimal")
            if (bearer != null) setRequestProperty("Authorization", "Bearer $bearer")
            if (body != null) doOutput = true
        }
        if (body != null) connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) throw IllegalStateException("HTTP $code: $text")
        return text
    }
}
