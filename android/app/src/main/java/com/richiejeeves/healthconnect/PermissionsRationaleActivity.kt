package com.richiejeeves.healthconnect

import android.app.Activity
import android.os.Bundle
import android.widget.TextView

class PermissionsRationaleActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "Jeeves reads only the health data types you approve in Health Connect. Data is sent securely to your private Jeeves account so you can review your activity, heart rate, sleep, weight, body fat and blood pressure together. You can revoke access at any time in Health Connect settings."
            textSize = 18f
            setPadding(32, 48, 32, 32)
        })
    }
}
