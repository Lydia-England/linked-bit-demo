
import { useEffect, useState } from "react";

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
 

export default function App() { 
  const [uid, setUid] = useState("");
  const [status, setStatus] = useState("Signing in...");
  const [session, setSession] = useState(null);
  const [participant, setParticipant] = useState(null);
  const [publicState, setPublicState] = useState(null);
  const [privateState, setPrivateState] = useState(null);

  const [actionPending, setActionPending] = useState(false);

  const [instructorState, setInstructorState] =
    useState({
      public: null,
      private: null
    });

  const params = new URLSearchParams(window.location.search);

  const invitedSessionId = params.get("session");
  const invitedRole = params.get("role");
  const invitedToken = params.get("token");

  const isInvitationLink =
    invitedSessionId &&
    invitedRole &&
    invitedToken;

  useEffect(() => {
    let unsubscribePublic = null;
    let unsubscribePrivate = null;

    async function initialize() {
      try {
        const user = await ensureSignedIn();

        setUid(user.uid);

      if (!isInvitationLink) {
        setStatus(
        "Signed in. You may create an instructor session."
        );

        return;
      }

      setStatus(`Claiming Group ${invitedRole}...`);

      const response =
        await claimParticipantRoleFunction({
          sessionId: invitedSessionId,
          role: invitedRole,
          token: invitedToken
        });

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
            `Public-state read failed: ${error.message}`
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
	    `Private-state read failed: ${error.message}`
	  );
	}
      );
   } catch (error) {
    console.error(error);

      setStatus(
        error.message ||
        "Firebase initialization failed."
      );
    }
  }

  initialize();

  return () => {
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

  async function createSession() {
    try {
      setStatus("Creating session...");

      const response = await createSessionFunction();

      const {
        sessionId,
        groupAToken,
        groupBToken
      } = response.data;

      const origin = window.location.origin;

      const groupALink =
        `${origin}/?session=${encodeURIComponent(sessionId)}` +
        `&role=A&token=${encodeURIComponent(groupAToken)}`;

      const groupBLink =
        `${origin}/?session=${encodeURIComponent(sessionId)}` +
        `&role=B&token=${encodeURIComponent(groupBToken)}`;

      setSession({
        sessionId,
        groupALink,
        groupBLink
      });

      const instructorPublicRef = ref(
        database,
        `sessions/${sessionId}/public`
      );

      const instructorPrivateRef = ref(
        database,
        `sessions/${sessionId}/private`
      );

      onValue(
      instructorPublicRef,
      (snapshot) => {
        setInstructorState((current) => ({
          ...current,
          public: snapshot.val()
        }));
      },
      (error) => {
        console.error(
          "Instructor public-state listener failed:",
          error
        );
      }
    );

    onValue(
      instructorPrivateRef,
      (snapshot) => {
        setInstructorState((current) => ({
          ...current,
          private: snapshot.val()
        }));
      },
      (error) => {
        console.error(
          "Instructor private-state listener failed:",
          error
        );
      }
    );

      setStatus("Session created.");
    } catch (error) {
      console.error(error);

      setStatus(
        error.message ||
        "The session could not be created."
      );
    }
  } // end async function createSession()

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

        if (response.data.alreadyMeasured) {
          setStatus(
            `Previously measured ${response.data.value}.`
          );
        } else {
          setStatus(
            `Measured ${response.data.value}.`
          );
        }
      } catch (error) {
        console.error(error);

        setStatus(
          error.message ||
          "The measurement could not be completed."
        );
      } finally {
        setActionPending(false);
      }
    } // end async function measure()

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
            ? "Entanglement turned on."
            : "Entanglement turned off."
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
    } // end async function changeEntanglement()

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
      "The round could not be advanced."
    );
  } finally {
    setActionPending(false);
  }
} // end async function advanceRound()

    return (
      <main
        style={{
          maxWidth: "900px",
          margin: "0 auto",
          padding: "2rem",
          fontFamily: "sans-serif"
        }}
      >
      <h1>Linked Bit Lab</h1>

      <p>{status}</p>

    {uid && (
      <p>
        Current anonymous UID: <code>{uid}</code>
      </p>
    )}

    {!isInvitationLink && (
      <section>
      <h2>Instructor session test</h2>

      <button
        type="button"
        onClick={createSession}
      >
        Create Session
      </button>

    {session && (
      <div style={{ marginTop: "2rem" }}>
      <h3>
        Session {session.sessionId}
      </h3>

      <p>
        Open each link in a different browser,
        browser profile, or private window.
      </p>

      <h4>Group A link</h4>

      <textarea
        readOnly
        rows="4"
        style={{ width: "100%" }}
        value={session.groupALink}
      />

      <h4>Group B link</h4>

      <textarea
        readOnly
        rows="4"
        style={{ width: "100%" }}
        value={session.groupBLink}
      />

      <hr style={{ margin: "2rem 0" }} />

      <h3>Instructor controls</h3>

      <p>
        Current mode:{" "}
        <strong>
          {instructorState.public?.mode ?? "Loading"}
        </strong>
      </p>

      <p>
        Current round:{" "}
        <strong>
          {instructorState.public?.round ?? "Loading"}
        </strong>
      </p>

      <p>
        Round ready:{" "}
        <strong>
          {instructorState.public?.roundReady
            ? "Yes"
            : "No"}
        </strong>
      </p>

      <h4>Group status</h4>

      <p>
        Group A:{" "}
        <strong>
          {instructorState.private?.A?.measured
            ? `Measured ${
	      instructorState.private.A.result
	    }`
            : "Waiting"}
        </strong>
      </p>

      <p>
        Group B:{" "}
        <strong>
          {instructorState.private?.B?.measured
            ? `Measured ${
	      instructorState.private.B.result
	    }`
            : "Waiting"}
        </strong>
      </p>

      <div
        style={{
          display: "flex",
	  gap: "1rem",
	  marginBottom: "1rem"
        }}
      >
        <button
          type="button"
          disabled={
            actionPending ||
            instructorState.private?.A?.measured ||
            instructorState.private?.B?.measured
          }
          onClick={() => changeEntanglement(false)}
        >
          Entanglement OFF
        </button>
  
        <button
          type="button"
          disabled={
            actionPending ||
            instructorState.private?.A?.measured ||
            instructorState.private?.B?.measured
          }
          onClick={() => changeEntanglement(true)}
        >
          Entanglement ON
        </button>
      </div>

      <button
        type="button"
        disabled={
          actionPending ||
          instructorState.public?.roundReady !== true
        }
        onClick={advanceRound}
      >
        Start Next Round
      </button>


    </div>
    )}
    </section>
  )}

  {participant && (
    <section>
    <h2>
      Participant: Group {participant.role}
    </h2>

    <p>
      Session: <code>{participant.sessionId}</code>
    </p>

    <h3>Public state</h3>

    <pre>
      {JSON.stringify(publicState, null, 2)}
    </pre>

    <h3>Your private state</h3>

    <pre>
    {JSON.stringify(privateState, null, 2)}
    </pre>

    <button
      type="button"
      onClick={measure}
      disabled={
        actionPending ||
        publicState?.status !== "ready" ||
        privateState?.measured === true
      }
    >
      {privateState?.measured
        ? "Measurement complete"
        : actionPending
          ? "Measuring..."
          : "Measure"}
    </button>

  </section>
  )}
  </main>
  );
}
