package com.richiejeeves.healthconnect

import android.app.Activity
import android.os.Bundle
import android.graphics.Color
import android.view.Gravity
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.activity.result.ActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.util.concurrent.TimeUnit
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission.Companion.PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND
import com.google.firebase.messaging.FirebaseMessaging
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

class MainActivity : ComponentActivity() {
    private val supabaseUrl = "https://aelsipdtezvhjkwsshqx.supabase.co"
    private val publishableKey = "sb_publishable_JbN0kUdtX6d5J8bWAPbz4w_syw2aG4K"
    private lateinit var emailInput: EditText
    private lateinit var passwordInput: EditText
    private lateinit var status: TextView
    private lateinit var firebaseStatus: TextView
    private lateinit var permissionLauncher: ActivityResultLauncher<Set<String>>
    private var healthClient: HealthConnectClient? = null
    private var queueListenerJob: Job? = null
    private var processingQueueRequest = false
    private val requestedPermissions by lazy {
        setOf(
            HealthPermission.getReadPermission(StepsRecord::class),
            HealthPermission.getReadPermission(HeartRateRecord::class),
            HealthPermission.getReadPermission(SleepSessionRecord::class),
            HealthPermission.getReadPermission(WeightRecord::class),
            HealthPermission.getReadPermission(BodyFatRecord::class),
            HealthPermission.getReadPermission(BloodPressureRecord::class)
        )
    }

    private val prefs by lazy {
        val masterKey = MasterKey.Builder(this).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            this, "jeeves_auth", masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        permissionLauncher = registerForActivityResult(
            PermissionController.createRequestPermissionResultContract()
        ) { _ ->
            lifecycleScope.launch {
                val client = healthClient
                val granted = client?.permissionController?.getGrantedPermissions().orEmpty()
                val backgroundAvailable = client?.features?.getFeatureStatus(
                    HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
                ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
                status.text = when {
                    PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted ->
                        "Health Connect background access is enabled. Background sync is ready."
                    backgroundAvailable ->
                        "Health data access is granted, but background access is not. Tap Connect Health Connect and allow background access."
                    else ->
                        "Health data access is granted. This Health Connect version does not support background reading."
                }
            }
        }
        buildScreen()
        // Restore the encrypted Supabase session automatically; never persist the password.
        restoreSavedLogin()
        val sdkStatus = HealthConnectClient.getSdkStatus(this)
        if (sdkStatus == HealthConnectClient.SDK_AVAILABLE) {
            healthClient = HealthConnectClient.getOrCreate(this)
            status.text = "Health Connect is available. Sign in, then connect your data."
        } else {
            status.text = "Health Connect is not available. Install or update Health Connect, then reopen Jeeves Health."
        }
    }

    override fun onResume() {
        super.onResume()
        scheduleBackgroundSync()
        registerFirebaseDevice()
        startForegroundQueueListener()
    }

    override fun onPause() {
        queueListenerJob?.cancel()
        queueListenerJob = null
        super.onPause()
    }

    private fun startForegroundQueueListener() {
        if (queueListenerJob?.isActive == true) return
        queueListenerJob = lifecycleScope.launch {
            while (isActive) {
                if (prefs.getString("refresh_token", null) != null) {
                    try { processQueuedHealthRequest() }
                    catch (e: Exception) { status.text = "Health sync queue check failed: ${e.message ?: "Unknown error"}" }
                }
                delay(5000)
            }
        }
    }

    private suspend fun processQueuedHealthRequest() {
        if (processingQueueRequest || healthClient == null) return
        processingQueueRequest = true
        try {
            val token = validAccessToken()
            val queue = withContext(Dispatchers.IO) {
                JSONArray(restRequest("GET", "$supabaseUrl/rest/v1/health_sync_requests?select=id&status=eq.queued&order=requested_at.asc&limit=1", null, token))
            }
            if (queue.length() == 0) return
            val id = queue.getJSONObject(0).getString("id")
            val itemUrl = "$supabaseUrl/rest/v1/health_sync_requests?id=eq.$id&status=eq.queued"
            val claimed = withContext(Dispatchers.IO) {
                JSONArray(restRequest("PATCH", itemUrl, JSONObject().put("status", "processing").put("started_at", Instant.now().toString()).put("error", JSONObject.NULL), token))
            }
            if (claimed.length() == 0) return
            status.text = "Processing Jeeves Desktop health sync request…"
            try {
                val synced = performSync()
                if (!synced) throw IllegalStateException(status.text.toString())
                withContext(Dispatchers.IO) { restRequest("PATCH", "$supabaseUrl/rest/v1/health_sync_requests?id=eq.$id", JSONObject().put("status", "completed").put("completed_at", Instant.now().toString()).put("error", JSONObject.NULL), token) }
                status.text = "Desktop health sync completed."
            } catch (e: Exception) {
                withContext(Dispatchers.IO) { restRequest("PATCH", "$supabaseUrl/rest/v1/health_sync_requests?id=eq.$id", JSONObject().put("status", "failed").put("completed_at", Instant.now().toString()).put("error", (e.message ?: "Foreground sync failed").take(500)), token) }
                status.text = "Desktop health sync failed: ${e.message ?: "Unknown error"}"
            }
        } finally { processingQueueRequest = false }
    }


    private fun registerFirebaseDevice() {
        if (!::firebaseStatus.isInitialized) return
        if (prefs.getString("refresh_token", null) == null) {
            firebaseStatus.text = "Firebase: sign in to register this device."
            return
        }
        firebaseStatus.text = "Firebase: requesting device token…"
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { fcmToken ->
                lifecycleScope.launch {
                    try {
                        val access = validAccessToken()
                        val user = withContext(Dispatchers.IO) {
                            JSONObject(restRequest("GET", "$supabaseUrl/auth/v1/user", null, access))
                        }
                        val payload = JSONObject()
                            .put("user_id", user.getString("id"))
                            .put("token", fcmToken)
                            .put("platform", "android")
                            .put("updated_at", Instant.now().toString())
                        withContext(Dispatchers.IO) {
                            restRequest("POST", "$supabaseUrl/rest/v1/health_device_tokens?on_conflict=token", payload, access)
                        }
                        firebaseStatus.text = "Firebase: device registered successfully."
                    } catch (e: Exception) {
                        firebaseStatus.text = "Firebase registration failed: ${e.message ?: "Unknown error"}"
                    }
                }
            }
            .addOnFailureListener { error ->
                firebaseStatus.text = "Firebase token error: ${error.message ?: "Google services unavailable"}"
            }
    }

    private fun scheduleBackgroundSync() {
        val manager = WorkManager.getInstance(applicationContext)
        val periodic = PeriodicWorkRequestBuilder<HealthSyncWorker>(15, TimeUnit.MINUTES).build()
        manager.enqueueUniquePeriodicWork(
            "jeeves-health-sync-periodic",
            ExistingPeriodicWorkPolicy.KEEP,
            periodic
        )
        if (prefs.getString("refresh_token", null) != null) {
            val immediate = OneTimeWorkRequestBuilder<HealthSyncWorker>().build()
            manager.enqueueUniqueWork(
                "jeeves-health-connect-sync",
                ExistingWorkPolicy.KEEP,
                immediate
            )
        }
    }

    private fun restRequest(method: String, url: String, body: JSONObject?, bearer: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 20000
            setRequestProperty("apikey", publishableKey)
            setRequestProperty("Authorization", "Bearer $bearer")
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("Prefer", when (method) {
                "POST" -> "resolution=merge-duplicates,return=minimal"
                "PATCH" -> "return=representation"
                else -> "return=minimal"
            })
            if (body != null) doOutput = true
        }
        if (body != null) connection.outputStream.use {
            it.write(body.toString().toByteArray(Charsets.UTF_8))
        }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val response = stream?.bufferedReader()?.use { it.readText() } ?: ""
        if (code !in 200..299) throw IllegalStateException("HTTP $code: $response")
        return response
    }

    private fun buildScreen() {
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(28, 42, 28, 28)
            setBackgroundColor(Color.rgb(16, 20, 28))
        }
        val scroll = ScrollView(this)
        val content = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun label(value: String, size: Float, color: Int = Color.WHITE) = TextView(this).apply {
            text = value; textSize = size; setTextColor(color); setPadding(0, 12, 0, 12)
        }
        content.addView(label("JEEVES", 14f, Color.rgb(201, 157, 104)))
        content.addView(label("Health companion", 30f))
        content.addView(label("Securely bring your approved health data into your private Jeeves account.", 16f, Color.LTGRAY))
        emailInput = EditText(this).apply {
            hint = "Jeeves account email"; setSingleLine(); setTextColor(Color.WHITE); setHintTextColor(Color.GRAY)
        }
        passwordInput = EditText(this).apply {
            hint = "Password"; inputType = 129; setSingleLine(); setTextColor(Color.WHITE); setHintTextColor(Color.GRAY)
        }
        content.addView(emailInput)
        content.addView(passwordInput)
        content.addView(actionButton("Sign in to Jeeves") { signIn() })
        content.addView(actionButton("Connect Health Connect") { connectHealth() })
        content.addView(actionButton("Sync now") { syncNow() })
        content.addView(actionButton("Sign out") {
            prefs.edit().clear().apply()
            emailInput.text.clear()
            passwordInput.text.clear()
            status.text = "Signed out. Saved login and session removed. Your Health Connect permissions remain under your control."
            firebaseStatus.text = "Firebase: sign in to register this device."
        })
        status = label("Checking Health Connect…", 14f, Color.rgb(205, 205, 205))
        content.addView(status)
        firebaseStatus = label("Firebase: checking device registration…", 14f, Color.rgb(205, 205, 205))
        content.addView(firebaseStatus)
        content.addView(label("Data requested: steps, heart rate, sleep, weight, body fat and blood pressure. Read-only access. Up to 30 days per sync.", 13f, Color.GRAY))
        scroll.addView(content)
        root.addView(scroll)
        setContentView(root)
    }

    private fun actionButton(title: String, action: () -> Unit) = Button(this).apply {
        text = title
        setTextColor(Color.WHITE)
        setBackgroundColor(Color.rgb(115, 82, 54))
        gravity = Gravity.CENTER
        setOnClickListener { action() }
    }

    private fun connectHealth() {
        val client = healthClient
        if (client == null) {
            status.text = "Health Connect is unavailable on this device."
            return
        }
        lifecycleScope.launch {
            val granted = client.permissionController.getGrantedPermissions()
            val backgroundAvailable = client.features.getFeatureStatus(
                HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND
            ) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
            when {
                !granted.containsAll(requestedPermissions) -> {
                    status.text = "Requesting Health Connect read permissions…"
                    permissionLauncher.launch(requestedPermissions)
                }
                backgroundAvailable && PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND !in granted -> {
                    status.text = "Requesting Health Connect background access…"
                    permissionLauncher.launch(setOf(PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND))
                }
                PERMISSION_READ_HEALTH_DATA_IN_BACKGROUND in granted ->
                    status.text = "Health Connect read and background access are enabled."
                else ->
                    status.text = "Health Connect read access is enabled, but this Health Connect version does not support background reading."
            }
        }
    }

    private fun restoreSavedLogin() {
        val savedEmail = prefs.getString("account_email", null)
        if (!savedEmail.isNullOrBlank()) emailInput.setText(savedEmail)
        if (prefs.getString("refresh_token", null) == null) return
        status.text = if (savedEmail.isNullOrBlank()) "Restoring your secure Jeeves session…" else "Welcome back, $savedEmail. Restoring your secure session…"
        lifecycleScope.launch {
            try {
                validAccessToken()
                status.text = if (savedEmail.isNullOrBlank()) "Signed in. Connect Health Connect if you have not already." else "Signed in as $savedEmail. Your login is remembered securely."
                registerFirebaseDevice()
                scheduleBackgroundSync()
            } catch (e: Exception) {
                status.text = "Saved session expired. Please sign in again."
            }
        }
    }

    private fun signIn() {
        val email = emailInput.text.toString().trim()
        val password = passwordInput.text.toString()
        if (email.isBlank() || password.isBlank()) {
            status.text = "Enter your Jeeves email and password."
            return
        }
        status.text = "Signing in securely…"
        lifecycleScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    postJson("$supabaseUrl/auth/v1/token?grant_type=password",
                        JSONObject().put("email", email).put("password", password), null)
                }
                saveSession(result)
                prefs.edit().putString("account_email", email).apply()
                passwordInput.text.clear()
                status.text = "Signed in as $email. Login remembered securely. Connect Health Connect next."
                registerFirebaseDevice()
                scheduleBackgroundSync()
            } catch (e: Exception) {
                status.text = "Sign-in failed: ${e.message ?: "Check your details and try again."}"
            }
        }
    }

    private fun saveSession(json: JSONObject) {
        val expiresIn = json.optLong("expires_in", 3600)
        prefs.edit()
            .putString("access_token", json.getString("access_token"))
            .putString("refresh_token", json.getString("refresh_token"))
            .putLong("expires_at", System.currentTimeMillis() / 1000 + expiresIn - 60)
            .apply()
    }

    private suspend fun validAccessToken(): String = withContext(Dispatchers.IO) {
        val current = prefs.getString("access_token", null)
        val expires = prefs.getLong("expires_at", 0)
        if (current != null && expires > System.currentTimeMillis() / 1000) return@withContext current
        val refresh = prefs.getString("refresh_token", null) ?: throw IllegalStateException("Sign in to Jeeves first.")
        val json = postJson("$supabaseUrl/auth/v1/token?grant_type=refresh_token",
            JSONObject().put("refresh_token", refresh), null)
        saveSession(json)
        json.getString("access_token")
    }

    private fun syncNow() {
        lifecycleScope.launch { performSync() }
    }

    private suspend fun performSync(): Boolean {
        if (healthClient == null) {
            status.text = "Health Connect is unavailable."
            return false
        }
        status.text = "Reading approved records…"
        return try {
            val token = validAccessToken()
            val records = readHealthRecords()
            if (records.length() == 0) {
                status.text = "No records found in the approved categories for the last 30 days."
                true
            } else {
                val batchSize = 100
                val totalBatches = (records.length() + batchSize - 1) / batchSize
                var syncedTotal = 0
                var batchNumber = 0
                for (start in 0 until records.length() step batchSize) {
                    batchNumber++
                    val batch = JSONArray()
                    val end = minOf(start + batchSize, records.length())
                    for (index in start until end) batch.put(records.getJSONObject(index))
                    status.text = "Uploading health data: batch $batchNumber of $totalBatches…"
                    val result = withContext(Dispatchers.IO) {
                        postJson("$supabaseUrl/functions/v1/health-sync",
                            JSONObject().put("records", batch), token)
                    }
                    syncedTotal += result.optInt("synced")
                }
                status.text = "Sync complete: $syncedTotal records sent to Jeeves."
                true
            }
        } catch (e: Exception) {
            status.text = "Sync failed: ${e.message ?: "Please try again."}"
            false
        }
    }

    private suspend fun readHealthRecords(): JSONArray {
        val client = healthClient ?: throw IllegalStateException("Health Connect unavailable.")
        val granted = client.permissionController.getGrantedPermissions()
        val since = Instant.now().minus(30, ChronoUnit.DAYS)
        val now = Instant.now()
        val range = TimeRangeFilter.between(since, now)
        val output = JSONArray()

        if (HealthPermission.getReadPermission(StepsRecord::class) in granted) {
            val today = LocalDate.now()
            for (daysAgo in 29 downTo 0) {
                val day = today.minusDays(daysAgo.toLong())
                val start = day.atStartOfDay(ZoneId.systemDefault()).toInstant()
                val end = minOf(day.plusDays(1).atStartOfDay(ZoneId.systemDefault()).toInstant(), now)
                if (end <= start) continue
                val aggregate = client.aggregate(
                    AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end))
                )
                val count = aggregate[StepsRecord.COUNT_TOTAL] ?: 0L
                if (count > 0) addRecord(output, "steps", "steps-$day",
                    start, end, JSONObject().put("count", count), "Health Connect", null)
            }
        }

        if (HealthPermission.getReadPermission(HeartRateRecord::class) in granted) {
            readAllRecords(client, HeartRateRecord::class, range).forEach { r ->
                val samples = JSONArray()
                r.samples.forEach { s -> samples.put(JSONObject().put("bpm", s.beatsPerMinute).put("time", s.time.toString())) }
                addRecord(output, "heart_rate", r.metadata.id, r.startTime, r.endTime,
                    JSONObject().put("samples", samples), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(SleepSessionRecord::class) in granted) {
            readAllRecords(client, SleepSessionRecord::class, range).forEach { r ->
                addRecord(output, "sleep", r.metadata.id, r.startTime, r.endTime,
                    JSONObject().put("duration_minutes", ChronoUnit.MINUTES.between(r.startTime, r.endTime))
                        .put("stage_count", r.stages.size), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(WeightRecord::class) in granted) {
            readAllRecords(client, WeightRecord::class, range).forEach { r ->
                addRecord(output, "weight", r.metadata.id, r.time, r.time,
                    JSONObject().put("kg", r.weight.inKilograms), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(BodyFatRecord::class) in granted) {
            readAllRecords(client, BodyFatRecord::class, range).forEach { r ->
                addRecord(output, "body_fat", r.metadata.id, r.time, r.time,
                    JSONObject().put("percentage", r.percentage.value), r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }

        if (HealthPermission.getReadPermission(BloodPressureRecord::class) in granted) {
            readAllRecords(client, BloodPressureRecord::class, range).forEach { r ->
                addRecord(output, "blood_pressure", r.metadata.id, r.time, r.time,
                    JSONObject().put("systolic_mmhg", r.systolic.inMillimetersOfMercury)
                        .put("diastolic_mmhg", r.diastolic.inMillimetersOfMercury)
                        .put("measurement_location", r.measurementLocation),
                    r.metadata.dataOrigin.packageName, r.metadata.device?.model)
            }
        }
        return output
    }

    private suspend fun <T : Record> readAllRecords(
        client: HealthConnectClient,
        recordType: kotlin.reflect.KClass<T>,
        range: TimeRangeFilter
    ): List<T> {
        val records = mutableListOf<T>()
        var pageToken: String? = null
        do {
            val page = client.readRecords(
                ReadRecordsRequest(recordType, timeRangeFilter = range, pageSize = 1000, pageToken = pageToken)
            )
            records.addAll(page.records)
            pageToken = page.pageToken
        } while (pageToken != null)
        return records
    }

    private fun addRecord(
        array: JSONArray, type: String, id: String, start: Instant, end: Instant,
        value: JSONObject, source: String?, device: String?
    ) {
        array.put(JSONObject()
            .put("record_type", type)
            .put("external_id", id.ifBlank { "${type}-${start}" })
            .put("start_time", start.toString())
            .put("end_time", end.toString())
            .put("value", value)
            .put("source_app", source ?: JSONObject.NULL)
            .put("source_device", device ?: JSONObject.NULL))
    }

    private fun postJson(url: String, body: JSONObject, bearer: String?): JSONObject {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 20000
            readTimeout = 30000
            doOutput = true
            setRequestProperty("Content-Type", "application/json")
            setRequestProperty("apikey", publishableKey)
            if (bearer != null) setRequestProperty("Authorization", "Bearer $bearer")
        }
        connection.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
        val code = connection.responseCode
        val stream = if (code in 200..299) connection.inputStream else connection.errorStream
        val text = stream.bufferedReader().use { it.readText() }
        if (code !in 200..299) {
            val message = try { JSONObject(text).optString("msg").ifBlank { JSONObject(text).optString("error") } } catch (_: Exception) { text }
            throw IllegalStateException("HTTP $code: $message")
        }
        return JSONObject(text)
    }
}
