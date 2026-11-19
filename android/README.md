# Jeeves Health (Android companion)

Native Android companion for the Jeeves web app. It uses the official Health Connect client and requests read-only access to steps, heart rate, sleep, weight, body fat and blood pressure.

## Build
Open the `android/` folder in Android Studio (Koala or newer), allow Gradle sync, then run the `app` configuration on an Android device with Health Connect installed.

- Application ID: `com.richiejeeves.healthconnect`
- Minimum Android: 9 (API 28); Health Connect availability depends on the device and installed provider.
- Target SDK: 35
- Health Connect dependency: 1.1.0

## First run
1. Sign in with the same email and password used for Jeeves.
2. Tap **Connect Health Connect** and approve only the data categories you want to share.
3. Tap **Sync now**. The first version performs a user-initiated sync of up to 30 days.
4. Check the Jeeves Health integration status in the web app after the first successful sync.

## Data handling
The app uses Supabase Auth password sign-in and stores access/refresh tokens in Android encrypted shared preferences. Health records are sent over HTTPS to the authenticated `health-sync` Edge Function. The function derives the user ID from the verified session; clients cannot choose another account's user ID. The database enforces row-level security.

No service-role key is embedded in the app. No write permissions are requested. ECG is not requested because Health Connect does not expose a standard ECG record type for this integration. Availability of each data category depends on the connected source apps and the user's grants.

## Privacy
Jeeves only reads records after explicit Health Connect permission. Users can revoke permissions in Android Health Connect settings and can sign out of the companion app at any time.
