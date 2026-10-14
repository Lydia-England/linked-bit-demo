import {
  useEffect,
  useRef,
  useState
} from "react";

import {
  httpsCallable
} from "firebase/functions";

import {
  onValue,
  ref
} from "firebase/database";

import {
  database,
  ensureSignedIn,
  functions
} from "./firebase";

import "./App.css";


  /*
  *  * Browser-side references to the trusted Cloud Functions.
  *   */

const createSessionFunction = httpsCallable(
  functions,
  "createSession"
);

const claimParticipantRoleFunction = httpsCallable(
  functions,
  "claimParticipantRole"
);

const measureFunction = httpsCallable(
  functions,
  "measure"
);

const setEntanglementFunction = httpsCallable(
  functions,
  "setEntanglement"
);

const nextRoundFunction = httpsCallable(
  functions,
  "nextRound"
);

const resumeInstructorSessionFunction =
  httpsCallable(
    functions,
    "resumeInstructorSession"
  );

const INSTRUCTOR_SESSION_STORAGE_KEY =
  "linkedBitLabInstructorSessionId";


export default function App() {
  const [status, setStatus] =
    useState("Connecting to Firebase...");

  const [session, setSession] =
    useState(null);

  const [participant, setParticipant] =
    useState(null);

  const [publicState, setPublicState] =
    useState(null);

  const [privateState, setPrivateState] =
    useState(null);

  const [actionPending, setActionPending] =
    useState(false);

  const [flashingBit, setFlashingBit] =
    useState(0);

  const [instructorState, setInstructorState] =
    useState({
      public: null,
      groupA: null,
      groupB: null
    });

  /*
  * We store instructor database unsubscribe functions here
  * so that React can clean them up if the page closes.
  */
  const instructorUnsubscribers = useRef([]);


  /*
  * Read participant invitation information from the URL.
  */

  const params = new URLSearchParams(
    window.location.search
  );

  const invitedSessionId =
    params.get("session");

  const invitedRole =
    params.get("role");

  const invitedToken =
    params.get("token");

  const isInvitationLink = Boolean(
    invitedSessionId &&
    invitedRole &&
    invitedToken
  );


  /*
  * Flash the displayed bit while a participant is eligible
  * to measure and has not yet measured.
  *
  * The flashing animation is local. Only the final measured
  * result comes from Firebase.
  */

  useEffect(() => {
    const shouldFlash =
      participant !== null &&
      publicState?.status === "ready" &&
      privateState?.measured !== true;

    if (!shouldFlash) {
      return undefined;
    }

    const interval = window.setInterval(() => {
      setFlashingBit(
        Math.random() < 0.5 ? 0 : 1
      );
    }, 85);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    participant,
    publicState?.status,
    privateState?.measured
  ]);


  /*
  ** Sign in and, if this is an invitation link, claim the
  ** participant role and subscribe to that participant's
  ** permitted database paths.
  **/

  useEffect(() => {
  let unsubscribePublic = null;
  let unsubscribePrivate = null;
  let cancelled = false;

  async function initialize() {
    try {
      await ensureSignedIn();

      if (cancelled) {
        return;
      }

      if (!isInvitationLink) {
        const savedSessionId =
          window.localStorage.getItem(
            INSTRUCTOR_SESSION_STORAGE_KEY
          );

          if (savedSessionId) {
            await recoverInstructorSession(
              savedSessionId
            );
          } else {
            setStatus(
              "Connected. Create a session when ready."
            );
          }

        return;
      }


    setStatus(
      `Connecting as Group ${invitedRole}...`
    );

    const response =
      await claimParticipantRoleFunction({
        sessionId: invitedSessionId,
        role: invitedRole,
        token: invitedToken
      });

    if (cancelled) {
      return;
    }

    const claimedSessionId =
      response.data.sessionId;

    const claimedRole =
      response.data.role;

    setParticipant({
      sessionId: claimedSessionId,
      role: claimedRole
    });

    const publicRef = ref(
      database,
      `sessions/${claimedSessionId}/public`
    );

    const privateRef = ref(
      database,
      `sessions/${claimedSessionId}/private/${claimedRole}`
    );

    unsubscribePublic = onValue(
      publicRef,
      (snapshot) => {
        setPublicState(snapshot.val());
      },
      (error) => {
        console.error(error);

        setStatus(
          `Unable to read session state: ${error.message}`
        );
      }
    );

    unsubscribePrivate = onValue(
      privateRef,
      (snapshot) => {
        setPrivateState(snapshot.val());

        setStatus(
          `Connected as Group ${claimedRole}.`
         );
      },
      (error) => {
        console.error(error);

        setStatus(
          `Unable to read participant state: ${error.message}`
        );
      }
    );
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
      "The application could not connect."
    );
  }
}

initialize();

return () => {
  cancelled = true;

  if (unsubscribePublic) {
    unsubscribePublic();
  }

  if (unsubscribePrivate) {
  unsubscribePrivate();
}
};
}, [
invitedSessionId,
invitedRole,
invitedToken,
isInvitationLink
]);


/*
*    * Remove instructor listeners when the page closes.
*       */

useEffect(() => {
return () => {
instructorUnsubscribers.current.forEach(
(unsubscribe) => unsubscribe()
);
};
}, []);

function buildParticipantLinks(
  sessionId,
  groupAToken,
  groupBToken
) {
  const origin = window.location.origin;

  const groupALink =
    `${origin}/?session=${encodeURIComponent(sessionId)}` +
    `&role=A&token=${encodeURIComponent(groupAToken)}`;

  const groupBLink =
    `${origin}/?session=${encodeURIComponent(sessionId)}` +
    `&role=B&token=${encodeURIComponent(groupBToken)}`;

  return {
    sessionId,
    groupALink,
    groupBLink
  };
}



function subscribeInstructorToSession(sessionId) {
  /*
  ** Stop listeners left over from an earlier session.
  **/

  instructorUnsubscribers.current.forEach(
    (unsubscribe) => unsubscribe()
  );

  instructorUnsubscribers.current = [];

  const publicRef = ref(
    database,
    `sessions/${sessionId}/public`
  );

  /*
  ** We listen to A and B separately rather than reading the
  ** entire private parent. Realtime Database Security Rules
  ** evaluate reads at the requested path.
  **/

  const groupARef = ref(
    database,
    `sessions/${sessionId}/private/A`
  );

  const groupBRef = ref(
    database,
    `sessions/${sessionId}/private/B`
  );

  const unsubscribePublic = onValue(
    publicRef,
    (snapshot) => {
      setInstructorState((current) => ({
        ...current,
        public: snapshot.val()
      }));
    },
    (error) => {
      console.error(
        "Instructor public listener failed:",
        error
      );
    }
  );

  const unsubscribeA = onValue(
    groupARef,
    (snapshot) => {
      setInstructorState((current) => ({
        ...current,
        groupA: snapshot.val()
      }));
    },
    (error) => {
      console.error(
        "Instructor Group A listener failed:",
        error
      );
    }
  );

  const unsubscribeB = onValue(
    groupBRef,
    (snapshot) => {
      setInstructorState((current) => ({
        ...current,
        groupB: snapshot.val()
      }));
    },
    (error) => {
      console.error(
        "Instructor Group B listener failed:",
        error
      );
    }
  );

  instructorUnsubscribers.current = [
    unsubscribePublic,
    unsubscribeA,
    unsubscribeB
  ];
}


async function recoverInstructorSession(
  savedSessionId
) {
  try {
    setActionPending(true);
    setStatus("Restoring instructor session...");

    const response =
      await resumeInstructorSessionFunction({
        sessionId: savedSessionId
      });

    const {
      sessionId,
      groupAToken,
      groupBToken
    } = response.data;

    const sessionDetails =
      buildParticipantLinks(
      sessionId,
      groupAToken,
      groupBToken
    );

    setSession(sessionDetails);

    setInstructorState({
      public: null,
      control: null,
      groupA: null,
      groupB: null
    });

    subscribeInstructorToSession(sessionId);

    setStatus(
      `Session ${sessionId} restored.`
    );

    return true;
  } catch (error) {
    console.error(
      "Instructor session recovery failed:",
      error
    );

	/*
	* * Remove a stale saved session. This can happen if:
	* *
	* * - the emulator restarted and deleted local data
	* * - the production session was deleted
	* * - anonymous browser identity was cleared
	* * - the session belongs to another instructor browser
	* */
    window.localStorage.removeItem(
      INSTRUCTOR_SESSION_STORAGE_KEY
    );

    setSession(null);

    setInstructorState({
      public: null,
      control: null,
      groupA: null,
      groupB: null
    });

    setStatus(
      "The previous session could not be restored. Create a new session."
    );

    return false;
  } finally {
    setActionPending(false);
  }
} // end recoverInstructorSession()

function forgetInstructorSession() {
  instructorUnsubscribers.current.forEach(
    (unsubscribe) => unsubscribe()
  );

  instructorUnsubscribers.current = [];

  window.localStorage.removeItem(
    INSTRUCTOR_SESSION_STORAGE_KEY
    );

  setSession(null);

  setInstructorState({
    public: null,
    control: null,
    groupA: null,
    groupB: null
  });

  setStatus(
    "Session removed from this browser."
  );
} // end forgetInstructorSession()



async function createSession() {
  try {
    setActionPending(true);
    setStatus("Creating session...");

    const response =
      await createSessionFunction();

    const {
      sessionId,
      groupAToken,
      groupBToken
    } = response.data;


    const sessionDetails =
      buildParticipantLinks(
      sessionId,
      groupAToken,
      groupBToken
    );

    setSession(sessionDetails);

    window.localStorage.setItem(
      INSTRUCTOR_SESSION_STORAGE_KEY,
      sessionId
    );


    setInstructorState({
      public: null,
      groupA: null,
      groupB: null
    });

    subscribeInstructorToSession(sessionId);

    setStatus("Session created.");
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
      "The session could not be created."
    );
  } finally {
    setActionPending(false);
  }
}


async function measure() {
  if (!participant) {
    return;
  }

  try {
    setActionPending(true);
    setStatus("Measuring...");

    const response = await measureFunction({
      sessionId: participant.sessionId
    });

    setStatus(
      response.data.alreadyMeasured
      ? "Your previously recorded result is displayed."
      : "Measurement complete."
    );
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
      "The measurement could not be completed."
    );
  } finally {
    setActionPending(false);
  }
}


async function changeEntanglement(enabled) {
  if (!session) {
    return;
  }

  try {
    setActionPending(true);

    await setEntanglementFunction({
    sessionId: session.sessionId,
    enabled
    });

    setStatus(
      enabled
      ? "Entanglement is now ON."
      : "Entanglement is now OFF."
    );
    } catch (error) {
      console.error(error);

      setStatus(
        error.message ||
        "The entanglement setting could not be changed."
      );
    } finally {
      setActionPending(false);
  }
}


async function advanceRound() {
  if (!session) {
    return;
  }

  try {
    setActionPending(true);

    const response = await nextRoundFunction({
      sessionId: session.sessionId
    });

    setStatus(
      `Round ${response.data.round} started.`
    );
  } catch (error) {
    console.error(error);

    setStatus(
      error.message ||
      "The next round could not be started."
    );
  } finally {
    setActionPending(false);
  }
}


async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Link copied to the clipboard.");
  } catch (error) {
    console.error(error);
    setStatus("The link could not be copied.");
  }
}


/*
* Participant interface
*/

if (isInvitationLink) {
  const hasMeasured =
    privateState?.measured === true;

  const sessionReady =
    publicState?.status === "ready";

  const displayedBit = hasMeasured
    ? privateState?.result
    : flashingBit;

  const measureDisabled =
    actionPending ||
    !sessionReady ||
    hasMeasured;

  let participantMessage =
    "Connecting to the experiment...";

  if (participant && !sessionReady) {
    participantMessage =
      "Waiting for the other group to join.";
  }

  if (
    participant &&
    sessionReady &&
    !hasMeasured
  ) {
    participantMessage =
      "Press Measure when your group is ready.";
  }

  if (hasMeasured) {
    participantMessage =
      "Measurement complete. Please wait for the next round.";
  }

  return (
  <main className="participant-page">
  <section className="participant-shell">
  <header className="participant-header">
  <div>
  <p className="eyebrow">
    Linked Bit Lab
  </p>

  <h1>
    Group {participant?.role ?? invitedRole}
  </h1>
  </div>

  <div className="round-chip">
    Round {publicState?.round ?? "—"}
  </div>
  </header>

  <section className="experiment-card">
  <div className="participant-meta">
  <span
    className={
      publicState?.mode === "entangled"
      ? "mode-chip mode-entangled"
      : "mode-chip mode-independent"
    }
  >
    {publicState?.mode === "entangled"
      ? "Entanglement ON"
      : "Entanglement OFF"}
  </span>

  <span className="privacy-label">
    Private group display
  </span>
</div>

  <div
    className={
      hasMeasured
      ? "bit-panel bit-panel-measured"
      : "bit-panel"
    }
  >
    <div
      className={
        hasMeasured
        ? "bit-value measured-value"
        : "bit-value flashing-value"
      }
    >
      {displayedBit ?? "—"}
    </div>

    <p className="participant-message">
      {participantMessage}
    </p>
  </div>

  <button
    type="button"
    className="measure-button"
    onClick={measure}
    disabled={measureDisabled}
  >
    {hasMeasured
      ? "Measurement Complete"
      : actionPending
      ? "Measuring..."
      : "Measure"}
  </button>

  <p className="connection-status">
    {status}
  </p>
  </section>
  </section>
</main>
);
}


  /*
  ** Instructor interface
  **/

const groupAMeasured =
  instructorState.groupA?.measured === true;

const groupBMeasured =
  instructorState.groupB?.measured === true;

const aOrBMeasured =
  groupAMeasured || groupBMeasured;

const roundReady =
  instructorState.public?.roundReady === true;

return (
  <main className="instructor-page">
    <section className="instructor-shell">
      <header className="instructor-header">
        <div>
          <p className="eyebrow">
            Linked Bit Lab
          </p>

          <h1>Instructor Dashboard</h1>

          <p className="header-description">
            Create a session, distribute the two
            participant links, and control each round.
          </p>
        </div>

 
    {session && (
      <div className="session-header-actions">
  	<div className="session-code-card">
          <span>Session</span>
           <strong>{session.sessionId}</strong>
        </div>
	 
        <button
            type="button"
            className="forget-session-button"
            onClick={forgetInstructorSession}
        >
            Forget Session
        </button>
    </div>
    )}


      </header>

      {!session && (
        <section className="welcome-card">
          <h2>Start a new experiment</h2>

            <p>
              A new session creates separate private links
              for Group A and Group B.
            </p>

            <button
              type="button"
              className="primary-button"
              onClick={createSession}
              disabled={actionPending}
            >
              {actionPending
              ? "Creating Session..."
              : "Create Session"}
            </button>
          </section>
        )}

        {session && (
          <>
          <section className="dashboard-grid">
            <article className="dashboard-card">
              <p className="card-label">
                Current Round
              </p>

              <div className="large-stat">
                {instructorState.public?.round ?? "—"}
              </div>

              <p className="card-detail">
                {roundReady
                ? "Both groups have measured."
                : "Waiting for both measurements."}
              </p>
            </article>

            <article className="dashboard-card">
              <p className="card-label">
                Measurement Mode
              </p>

<div className="mode-control">
  <button
  type="button"
  className={
  instructorState.public?.mode ===
  "independent"
  ? "mode-control-button selected-independent"
  : "mode-control-button"
  }
  disabled={
    actionPending ||
    aOrBMeasured
  }
  onClick={() =>
    changeEntanglement(false)
  }
  >
  OFF
  </button>

  <button
    type="button"
    className={
      instructorState.public?.mode ===
        "entangled"
        ? "mode-control-button selected-entangled"
        : "mode-control-button"
      }
  disabled={
    actionPending ||
    aOrBMeasured
  }
    onClick={() =>
      changeEntanglement(true)
    }
  >
    ON
  </button>
  </div>

  <p className="card-detail">
    Mode cannot change after either group
    measures.
  </p>
  </article>
  </section>

  <section className="group-status-grid">
    <article
      className={
        groupAMeasured
        ? "group-card group-complete"
        : "group-card"
      }
    >
    <div className="group-card-header">
    <h2>Group A</h2>

    <span className="status-chip">
      {groupAMeasured
      ? "Measured"
      : "Waiting"}
  </span>
  </div>

    <div className="instructor-result">
      {groupAMeasured
      ? instructorState.groupA?.result
      : "—"}
    </div>
  </article>

  <article
    className={
      groupBMeasured
      ? "group-card group-complete"
      : "group-card"
    }
  >
  <div className="group-card-header">
  <h2>Group B</h2>

    <span className="status-chip">
      {groupBMeasured
      ? "Measured"
      : "Waiting"}
    </span>
  </div>

  <div className="instructor-result">
    {groupBMeasured
      ? instructorState.groupB?.result
    : "—"}
  </div>
  </article>
  </section>

  <section className="round-control-card">
  <div>
  <h2>Round controls</h2>

  <p>
    The next round becomes available after
    both groups have measured.
  </p>
  </div>

  <button
    type="button"
    className="primary-button next-round-button"
    disabled={
      actionPending ||
      !roundReady
    }
    onClick={advanceRound}
  >
    {actionPending
    ? "Updating..."
    : "Start Next Round"}
  </button>
</section>

  <section className="links-card">
    <div className="section-heading">
      <div>
        <h2>Participant links</h2>

        <p>
          Open each link on the corresponding
          participant laptop.
        </p>
      </div>
    </div>

    <div className="link-block">
      <label htmlFor="group-a-link">
        Group A link
      </label>
  
      <div className="link-row">
        <input
          id="group-a-link"
          readOnly
          value={session.groupALink}
        />

        <button
          type="button"
          className="copy-button"
          onClick={() =>
            copyText(session.groupALink)
          }
        >
          Copy
        </button>
      </div>
    </div>

    <div className="link-block">
      <label htmlFor="group-b-link">
        Group B link
      </label>

      <div className="link-row">
        <input
          id="group-b-link"
          readOnly
          value={session.groupBLink}
        />

        <button
          type="button"
          className="copy-button"
          onClick={() =>
            copyText(session.groupBLink)
          }
        >
          Copy
        </button>
      </div>
    </div>
  </section>
</>
)}

<p className="dashboard-status">
  {status}
</p>
</section>
</main>
);
}
