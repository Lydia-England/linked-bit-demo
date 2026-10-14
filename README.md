# Linked Bit Lab

Linked Bit Lab is a browser-based classroom experiment for an instructor and two participant groups. Each group sees a rapidly flashing `0` and `1`, presses **Measure**, and privately receives a server-generated result. With entanglement **ON**, both groups receive the same result; with entanglement **OFF**, the two results are generated independently.

## Live site

- Instructor site: `https://entangled-bit-demo.web.app`
- Firebase project ID: `entangled-bit-demo`

The instructor creates a session from the main page, then distributes the generated Group A and Group B links to separate participant browsers or laptops.

## Main features

- Separate instructor, Group A, and Group B interfaces
- Anonymous browser authentication, with no participant accounts or passwords
- Private invitation links that assign each participant browser to one role
- Server-generated 50/50 results
- Entangled and independent measurement modes
- One measurement per group per round
- Instructor-controlled mode changes and round advancement
- Participant privacy: each group can read only its own result
- Instructor session recovery after page refresh
- Firebase App Check enforcement for production requests
- Realtime Database Security Rules that separate public, private, instructor-only, and server-only data

## Technology

- React and Vite for the browser interface
- Firebase Hosting for the deployed website
- Firebase Authentication for anonymous browser identities
- Firebase Realtime Database for synchronized session state
- Cloud Functions for Firebase for trusted measurement and control logic
- Firebase App Check with reCAPTCHA Enterprise for request attestation
- Git for local version control

## Project structure

```text
linked-bit-demo/
├── functions/
│   ├── index.js                 # Callable Cloud Functions
│   ├── package.json             # Functions dependencies and scripts
│   ├── package-lock.json
│   └── .eslintrc.js             # Functions lint configuration
├── src/
│   ├── App.jsx                  # Instructor and participant interfaces
│   ├── App.css                  # Application styling
│   ├── firebase.js              # Firebase client initialization
│   ├── index.css
│   └── main.jsx
├── database.rules.json          # Realtime Database Security Rules
├── firebase.json                # Firebase services and emulator configuration
├── .firebaserc                  # Default Firebase project alias
├── .gitignore
├── eslint.config.js             # React/Vite lint configuration
├── index.html
├── package.json                 # Browser application dependencies and scripts
├── package-lock.json
└── vite.config.js
```

Generated folders such as `node_modules/`, `dist/`, `.firebase/`, and emulator data should remain excluded from Git.

## Cloud Functions

The backend exports six callable functions:

- `createSession`: Creates a session, instructor assignment, and private invitation tokens.
- `claimParticipantRole`: Verifies an invitation and assigns the authenticated browser to Group A or Group B.
- `measure`: Generates the participant's result, applies the selected mode, prevents repeat measurements, and records round state.
- `setEntanglement`: Allows only the instructor to switch between entangled and independent modes before measurement begins.
- `nextRound`: Allows only the instructor to advance after both groups have measured.
- `resumeInstructorSession`: Verifies instructor ownership and restores the dashboard and invitation links after refresh.

Production callable functions require valid Firebase Authentication and App Check tokens.

## Database layout

A session is stored approximately as follows:

```text
sessions/{sessionId}/
├── public/           # Round, mode, and session status; readable by session members
├── control/          # Instructor-only coordination state
├── participants/     # Server-only role assignments
├── invitations/      # Server-only invitation tokens
├── private/A/        # Readable only by Group A and the instructor
├── private/B/        # Readable only by Group B and the instructor
├── server/           # Server-only shared entangled result
└── history/          # Instructor-only backend measurement records
```

Participant browsers do not receive the other group's result, measurement status, invitation token, shared result, or instructor control state.

## Prerequisites for development

Install:

- Node.js 22 LTS
- npm
- Java JDK 11 or later for the Firebase Emulator Suite
- Firebase CLI
- Git
- A code editor such as Visual Studio Code

Install the Firebase CLI globally:

```powershell
npm install -g firebase-tools
firebase login
```

## Initial installation

From the project root:

```powershell
npm install
cd functions
npm install
cd ..
```

The root dependencies are for the React website. The `functions` dependencies are installed separately for the server-side Cloud Functions environment.

## Local development

Use two PowerShell windows.

### Window 1: Firebase emulators

```powershell
cd C:\path\to\linked-bit-demo
firebase emulators:start
```

The Emulator UI is normally available at:

```text
http://127.0.0.1:4000
```

### Window 2: React development server

```powershell
cd C:\path\to\linked-bit-demo
npm run dev
```

Vite normally serves the site at:

```text
http://localhost:5173
```

Use separate browser profiles, private windows, or devices for the instructor, Group A, and Group B so that all three receive different anonymous Firebase identities.

App Check initializes only in a production build. Local development connects to the Authentication, Realtime Database, and Functions emulators.

## Local test checklist

Before deploying a change:

1. Create a new instructor session.
2. Open the Group A and Group B links in separate browser identities.
3. Confirm both participant displays flash and can measure.
4. Confirm entangled results match.
5. Advance the round.
6. Switch entanglement OFF before either group measures.
7. Confirm independent mode works.
8. Refresh the instructor page and confirm session recovery.
9. Confirm neither participant can read the other participant's private data.

## Linting Cloud Functions

From the Functions directory:

```powershell
cd functions
npm run lint
cd ..
```

The Functions lint script explicitly uses the `.eslintrc.js` configuration rather than the React project's root flat ESLint configuration.

## Production build

From the project root:

```powershell
npm run build
```

Vite writes the production website to `dist/`. Do not edit files in `dist` manually.

## Deployment

Deploy from the project root.

### Realtime Database rules

```powershell
firebase deploy --only database
```

### Cloud Functions

```powershell
firebase deploy --only functions
```

### Hosting

```powershell
npm run build
firebase deploy --only hosting
```

After deployment, test the live site at `https://entangled-bit-demo.web.app` with three separate browser identities.

## Firebase production configuration

The Firebase project uses:

- Anonymous Authentication enabled
- Realtime Database
- Cloud Functions on Node.js 22
- Firebase Hosting
- Firebase App Check with a score-based reCAPTCHA Enterprise website key
- App Check enforcement for Realtime Database
- `enforceAppCheck: true` on all six callable functions

The reCAPTCHA Enterprise key should authorize:

```text
entangled-bit-demo.web.app
entangled-bit-demo.firebaseapp.com
```

Do not commit service-account files, private administrator credentials, billing credentials, or downloaded secret keys. The Firebase browser configuration and reCAPTCHA site key are public client identifiers; authorization is enforced through Authentication, Security Rules, Cloud Functions, and App Check.

## Cost controls

The project is intended for light classroom use and should remain within Firebase's included no-cost usage allowances under normal operation. The project should nevertheless retain:

- A project-specific Google Cloud monthly budget alert
- Low alert thresholds
- A Cloud Functions spend cap, if available
- App Check enforcement
- Private distribution of participant links
- Periodic review of Firebase usage and billing
- An end date for disabling or deleting the deployment

## Classroom operation

1. Open the instructor site in the instructor browser.
2. Create a session shortly before the activity.
3. Copy the Group A link to the Group A laptop.
4. Copy the Group B link to the Group B laptop.
5. Keep the participant groups in separate browser identities.
6. Select entanglement ON or OFF before either group measures.
7. Wait until both groups have measured.
8. Select **Start Next Round**.
9. Use **Forget Session** only to remove the session from the instructor browser; it does not delete the Firebase data.

Edge or Chrome is recommended on the participant laptops for predictable App Check and reCAPTCHA Enterprise behavior.

## Git workflow

Check repository status:

```powershell
git status
```

Save a checkpoint:

```powershell
git add .
git commit -m "Describe the change"
```

Push committed changes to GitHub:

```powershell
git push
```

Never commit temporary editor backups, emulator exports, generated build files, dependencies, or credentials.

## Handoff options

### Maintain the existing live deployment

A future maintainer needs:

- Access to this Git repository
- Appropriate access to the Firebase and Google Cloud project
- Access to the associated billing account or transfer to a new billing account
- Access to the reCAPTCHA Enterprise configuration
- Permission to view logs, billing alerts, App Check metrics, and deployed services

The outgoing and incoming maintainers should jointly test a small deployment and confirm that the incoming maintainer can run the emulators, lint Functions, build the site, and deploy each Firebase component.

### Create an independent deployment

A maintainer can also use this repository as a template and create a separate Firebase project. That process requires registering a new Firebase web app, enabling Anonymous Authentication and Realtime Database, creating a new reCAPTCHA Enterprise key, replacing the client configuration in `src/firebase.js`, configuring App Check, setting billing alerts, and deploying rules, Functions, and Hosting.

## End-of-project shutdown

When the site is no longer needed:

1. Stop distributing new session links.
2. Delete old sessions from Realtime Database if the data is no longer needed.
3. Delete deployed Cloud Functions.
4. Disable Hosting or delete the Firebase project.
5. Verify that billing has stopped and remove the billing association when appropriate.
6. Retain the Git repository if future redeployment may be useful.

## License and reuse

No open-source license is included by default. Keep the GitHub repository private unless a deliberate decision is made to publish the source. Add an appropriate license before inviting unrestricted public reuse or redistribution.
