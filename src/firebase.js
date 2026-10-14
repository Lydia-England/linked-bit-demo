import { initializeApp } from "firebase/app";
import {
  connectAuthEmulator,
  getAuth,
  signInAnonymously
} from "firebase/auth";

import { 
  connectDatabaseEmulator,
  getDatabase
} from "firebase/database";

import {
  connectFunctionsEmulator,
  getFunctions
} from "firebase/functions";

import {
  initializeAppCheck,
  ReCaptchaEnterpriseProvider
} from "firebase/app-check";

// import { getDatabase } from "firebase/database";
// import { getFunctions } from "firebase/functions";

const firebaseConfig = {
  apiKey: "AIzaSyCW-GDl_tBPA-5FKPRIaR6uftGfPSuTLkk",
  authDomain: "entangled-bit-demo.firebaseapp.com",
  databaseURL: "https://entangled-bit-demo-default-rtdb.firebaseio.com",
  projectId: "entangled-bit-demo",
  storageBucket: "entangled-bit-demo.firebasestorage.app",
  messagingSenderId: "3501988614",
  appId: "1:3501988614:web:b7793203174bb525c31c87"
};

const app = initializeApp(firebaseConfig); 	// initialize connection between website and Firebase project

if (!import.meta.env.DEV) {
  initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(
      "6LfC_O4tAAAAAG_hWeFoGDOMSD2itDiFSnM0NIKd"
    ),
    isTokenAutoRefreshEnabled: true
  });
}

export const auth = getAuth(app);		// prepare Firebase Authentication
export const database = getDatabase(app);	// prepare Realtime Database access
export const functions = getFunctions(app);	// prepare callable Cloud Functions

console.log("Firebase project configuration:", {
  projectID: firebaseConfig.projectId,
  databaseURL: firebaseConfig.databaseURL
});

if (import.meta.env.DEV) { // ask if Vite is running in development mode
  connectAuthEmulator(
      auth,
      "http://127.0.0.1:9099",
      { disableWarnings: true }
    );

  connectDatabaseEmulator(
      database,
      "127.0.0.1",
      9000
    );

  connectFunctionsEmulator(
      functions,
      "127.0.0.1",
      5001
    );
}

export async function ensureSignedIn() {
	if (auth.currentUser) {		// check whether the browser already has a Firebase user
		return auth.currentUser;
	}

	const credential = await signInAnonymously(auth);	// if not, Firebase creates anonymous account for that browser.
	return credential.user;
}
