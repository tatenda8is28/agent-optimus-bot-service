// services/firebase.js (FINAL, CORRECTED VERSION)
const admin = require('firebase-admin');

// The .env file tells the SDK where to find the credentials
admin.initializeApp({
    credential: admin.credential.applicationDefault()
});

const db = admin.firestore();
const auth = admin.auth();

// --- THE CRITICAL FIX ---
// Export the 'admin' object itself so other services can use its features.
module.exports = { db, auth, admin };