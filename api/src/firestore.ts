import admin from "firebase-admin";

let initialized = false;

export function getDb(): FirebaseFirestore.Firestore {
  if (!initialized) {
    // Cloud Run / GCP: Application Default Credentials are preferred.
    // Local dev: can use GOOGLE_APPLICATION_CREDENTIALS or `gcloud auth application-default login`.
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT
    });
    initialized = true;
  }
  return admin.firestore();
}

