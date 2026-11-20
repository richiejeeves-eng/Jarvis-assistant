package com.richiejeeves.healthconnect

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.permission.HealthPermission.Companion.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
import androidx.health.connect.client.records.*
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
import java.time.temporal.ChronoUnit

class HealthSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    private val prefs by lazy {
        val master = MasterKey.Builder(applicationContext).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(applicationContext, "jeeves_auth", master,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
    }

    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        try {
            val token = validToken()
            // Do not claim desktop requests unless Android has granted true background
            // Health Connect access. The foreground listener in MainActivity handles
            // requests while the companion is open.
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
            if (required.none { it in granted }) return@withContext Result.success()
            if (PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in granted) return@withContext Result.success()

            // Recover requests abandoned by a process death or force-stop.
            val staleBefore = Instant.now().minus(10, ChronoUnit.MINUTES).toString()
            request(
                "PATCH",
                "$JeevesSupabaseConfig.URL/rest/v1/health_sync_requests?status=eq.processing&started_at=lt.$staleBefore",
                JSONObject().put("status", "queued").put("started_at", JSONObject.NULL).put("error", JSONObject.NULL),
                token
            )

            var processed = 0
            while (processed < 10) {
                val queue = JSONArray(request(
                    "GET",
                    "$JeevesSupabaseConfig.URL/rest/v1/health_sync_requests?select=id&status=eq.queued&order=requested_at.asc&limit=1",
                    null,
                    token
                ))
                if (queue.length() == 0) break

                val id = queue.getJSONObject(0).getString("id")
                val itemUrl = "$JeevesSupabaseConfig.URL/rest/v1/health_sync_requests?id=eq.$id"
                val claimed = JSONArray(request(
                    "PATCH",
                    "$itemUrl&status=eq.queued",
                    JSONObject().put("status", "processing").put("started_at", Instant.now().toString()).put("error", JSONObject.NULL),
                    token
                ))
                if (claimed.length() == 0) {
                    processed++
                    continue
                }

                try {
                    val records = HealthRecordReader.read(client, granted)
                    for (batchStart in 0 until records.length() step 100) {
                        val batch = JSONArray()
                        for (i in batchStart until minOf(batchStart + 100, records.length())) {
                            batch.put(records.getJSONObject(i))
                        }
                        request("POST", "$JeevesSupabaseConfig.URL/functions/v1/health-sync", JSONObject().put("records", batch), token)
                    }
                    request(
                        "PATCH",
                        itemUrl,
                        JSONObject().put("status", "completed").put("completed_at", Instant.now().toString()).put("error", JSONObject.NULL),
                        token
                    )
                } catch (error: Exception) {
                    request(
                        "PATCH",
                        itemUrl,
                        JSONObject().put("status", "failed").put("completed_at", Instant.now().toString())
                            .put("error", (error.message ?: "Background sync failed").take(500)),
                        token
                    )
                }
                processed++
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
        val json = JSONObject(request("POST", "$JeevesSupabaseConfig.URL/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refresh), null))
        prefs.edit().putString("access_token", json.getString("access_token"))
            .putString("refresh_token", json.getString("refresh_token"))
            .putLong("expires_at", System.currentTimeMillis() / 1000 + json.optLong("expires_in", 3600) - 60).apply()
        return json.getString("access_token")
    }

    private fun request(method: String, url: String, body: JSONObject?, bearer: String?): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method; connectTimeout = 20000; readTimeout = 30000
            setRequestProperty("apikey", JeevesSupabaseConfig.PUBLISHABLE_KEY); setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Prefer", if (method == "PATCH") "return=representation" else "return=minimal")
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
