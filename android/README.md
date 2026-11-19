# Jeeves Health (Android companion)

Native Android companion for the Jeeves web app. It uses the official Health Connect client and requests read-only access to steps, heart rate, sleep, weight, body fat and blood pressure.

## Build

Open the `android/` folder in Android Studio (Koala or newer), allow Gradle sync, then run the `app` configuration on an Android device with Health Connect installed.

- Application ID: `com.richiejeeves.healthconnect`
- Minimum Android: 9 (API 28); Health Connect availability depends on the device and installed provider.
- Target SDK: 35
- Health Connect dependency: 1.1.0
- Firebase Cloud Messaging and WorkManager are used for push-triggered background sync.

## Firebase configuration

The Firebase Android config belongs at `android/app/google-services.json` for local builds. Do not commit this file.

For GitHub Actions builds, add a repository Actions secret named `GOOGLE_SERVICES_JSON_BASE64` containing the Base64-encoded contents of that JSON file. The workflow writes it into the Android app directory only during the build.

## First run

1. Sign in with the same email and password used for Jeeves.
2. Tap **Connect Health Connect** and approve only the data categories you want to share.
3. Tap **Connect Health Connect** again after the category permissions are granted. If the device supports background reads, approve **Access data in the background** as well.
4. Keep Jeeves Health signed in and open it once after installation so its Firebase device token can be registered to your Jeeves account.
5. Open **Jeeves Fitness** in the web app and request a Health Connect sync. Jeeves sends a Firebase data message; Android enqueues a WorkManager job to read Health Connect and upload records, even when the activity is not open.
6. You can still tap **Sync now** in Jeeves Health to sync manually. Each sync reads up to 30 days.

## Data handling

The companion retains foreground queue polling as a fallback. For background requests, Firebase Cloud Messaging wakes the app's messaging service, which enqueues a WorkManager job. Background Health Connect reads require the user to grant the additional Health Connect background permission. Android may delay background work due to Doze, battery restrictions, connectivity or force-stop; push delivery and execution are best-effort, not guaranteed immediate. Health records are sent over HTTPS to the authenticated `health-sync` Edge Function. The function derives the user ID from the verified session; clients cannot choose another account's user ID. The database enforces row-level security.

No service-role key is embedded in the app. No write permissions are requested. ECG is not requested because Health Connect does not expose a standard ECG record type for this integration. Availability of each data category depends on the connected source apps and the user's grants.

## Privacy

Jeeves only reads records after explicit Health Connect permission. Users can revoke permissions in Android Health Connect settings and can sign out of the companion app at any time.
