import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyD9DQtV3nc93aiUWrc0g_GqKe2wcdpTwnQ",
  authDomain: "fraud-detection-2c5a2.firebaseapp.com",
  projectId: "fraud-detection-2c5a2",
};

function getApp(): FirebaseApp {
  if (!getApps().length) {
    return initializeApp(firebaseConfig);
  }
  return getApps()[0]!;
}

export const app = getApp();
export const auth: Auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
