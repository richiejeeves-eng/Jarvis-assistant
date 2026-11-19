package com.richiejeeves.healthconnect

import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.ExistingWorkPolicy

class JeevesMessagingService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        getSharedPreferences("jeeves_fcm", MODE_PRIVATE).edit().putString("pending_token", token).apply()
    }

    override fun onMessageReceived(message: RemoteMessage) {
        if (message.data["action"] == "health_sync") {
            val work = OneTimeWorkRequestBuilder<HealthSyncWorker>().build()
            WorkManager.getInstance(applicationContext)
                .enqueueUniqueWork("jeeves-health-connect-sync", ExistingWorkPolicy.KEEP, work)
        }
    }
}
