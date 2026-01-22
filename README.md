
# ScriptureScholar Bible Study App

A production-ready Bible Study MVP featuring structured AI-driven analysis of Biblical passages.

## Features
- **Passage Analysis**: Deep dives into historical context, original language (Greek/Hebrew), and themes.
- **Persistent Storage**: Save your studies securely using Firebase Firestore.
- **Authentication**: Google and Email/Password providers.
- **Interactive Chat**: Ask follow-up questions about specific passages.
- **User Notes**: Add and save personal reflections.

## Firebase Setup Steps
1. Create a project in the [Firebase Console](https://console.firebase.google.com/).
2. Enable **Authentication** (Google and Email/Password providers).
3. Create a **Firestore Database** in production mode.
4. Add a **Web App** to your project to get the Firebase configuration.
5. Update `firebase.ts` with your config keys.

## Firestore Security Rules
Paste these into the Rules tab of your Firestore dashboard:

```javascript
service cloud.firestore {
  match /databases/{database}/documents {
    
    // Helper function to check if the user is an admin
    function isAdmin() {
      return request.auth != null && 
        get(/databases/$(database)/documents/users/$(request.auth.uid)).data.role == 'admin';
    }

    // Rules for the Users collection
    match /users/{userId} {
      // Users can read/write their own profile; Admins can see all profiles
      allow read, update: if request.auth != null && (request.auth.uid == userId || isAdmin());
      allow create: if request.auth != null;
      
      // Rules for the 'history' sub-collection (where Bible studies are saved)
      match /history/{studyId} {
        allow read, write: if request.auth != null && (request.auth.uid == userId || isAdmin());
      }
    }
  }
}
```

## Running Locally
1. Ensure your Gemini API Key is available in the environment.
2. Update the `firebase.ts` placeholders.
3. Run `npm run dev` or equivalent to start the application.

## Deploying to Firebase
1. Install Firebase CLI: `npm install -g firebase-tools`
2. Initialize: `firebase init` (Select Hosting and Firestore)
3. Build the app.
4. Deploy: `firebase deploy`
