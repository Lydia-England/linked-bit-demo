/**
* Import function triggers from their respective submodules:
*
* const {onCall} = require("firebase-functions/v2/https");
* const {onDocumentWritten} = require("firebase-functions/v2/firestore");
*
* See a full list of supported triggers at https://firebase.google.com/docs/functions
*/
const crypto = require("crypto");

const {
  onCall,
  HttpsError
} = require("firebase-functions/v2/https");

const {
  initializeApp
} = require("firebase-admin/app");

const {
  getDatabase
} = require("firebase-admin/database");

initializeApp();

const REGION = "us-central1";

  /* 
   * Generates either 0 or 1 
   */
function randomBit() {
  return crypto.randomInt(0, 2);
}

/* 
 * Determines whether the supplies Firebase UID belongs 
 * to Group A, Group B, or neither group.
 */
function getParticipantRole(session, uid) {
  if (session.participants?.A?.uid === uid) {
    return "A";
  }

  if (session.participants?.B?.uid === uid) {
    return "B";
  }

  return null;
}

/*
 * * Verifies that a callable-function request came from
 * * an authenticated Firebase user.
 * */
function requireAuthentication(request) {
  if (!request.auth) {
    throw new HttpsError(
	"unauthenticated",
	"You must be signed in to perform this action."
    );
  }

  return request.auth.uid;
}

function createSessionCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  let code = "";

  for (let index = 0; index < 8; index += 1) {
    const randomIndex = crypto.randomInt(0, alphabet.length);
    code += alphabet[randomIndex];
  }

  return code;
}

function createInvitationToken() {
  return crypto.randomBytes(24).toString("hex");
}

async function findUnusedSessionCode(database) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const code = createSessionCode();

    const snapshot = await database
      .ref(`sessions/${code}`)
      .get();

    if (!snapshot.exists()) {
      return code;
    }
  }

  throw new HttpsError(
    "resource-exhausted",
    "Could not generate an unused session code."
  );
}

exports.createSession = onCall(
  {
    region: REGION
  },
  async (request) => {
    const instructorUid = requireAuthentication(request);
    const database = getDatabase();
    const sessionId = await findUnusedSessionCode(database);
    const groupAToken = createInvitationToken();
    const groupBToken = createInvitationToken();
    const session = {
      instructorUid,

      createdAt: Date.now(),

      public: {
        round: 1,
        mode: "entangled",
        status: "waiting-for-participants",
        roundReady: false
      },

      participants: {
        A: {
          uid: "",
          claimedAt: 0
        },

        B: {
          uid: "",
          claimedAt: 0
        }
      },

      invitations: {
        A: {
          token: groupAToken,
          used: false
        },
        B: {
          token: groupBToken,
          used: false
        }
      },

      private: {
        A: {
          measured: false,
          result: null
        },
        B: {
          measured: false,
          result: null
        }
      },

      server: {
        sharedResult: null
      },

      history: {}
    };

    await database
      .ref(`sessions/${sessionId}`)
      .set(session);

    return {
      sessionId,
      groupAToken,
      groupBToken
    };
  } 
);


exports.claimParticipantRole = onCall(
  {
    region: REGION
  },
  async (request) => {
    const participantUid = requireAuthentication(request);

    const sessionId = request.data?.sessionId;
    const role = request.data?.role;
    const token = request.data?.token;

    if (
      typeof sessionId !== "string" ||
      !/^[A-Z2-9]{8}$/.test(sessionId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The session ID is invalid."
      );
    }

    if (role !== "A" && role !== "B") {
      throw new HttpsError(
        "invalid-argument",
        "The participant role must be A or B."
      );
    }

    if (
      typeof token !== "string" ||
      token.length < 20
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The invitation token is invalid."
      );
    }

    const database = getDatabase();
    const sessionRef = database.ref(`sessions/${sessionId}`);

	/*
	*      * Read the complete session from the server.
	*           */
    const sessionSnapshot = await sessionRef.get();

    if (!sessionSnapshot.exists()) {
      throw new HttpsError(
        "not-found",
        `Session ${sessionId} does not exist.`
      );
    }

    const session = sessionSnapshot.val();

    const participant = session.participants?.[role];
    const invitation = session.invitations?.[role];

	/*
	*      * Check that the expected participant and invitation
	*           * records exist.
	*                */
    if (!participant || !invitation) {
      throw new HttpsError(
        "failed-precondition",
        "The session participant or invitation records are missing."
      );
    }

	/*
	*      * Check that this is the correct secret invitation link.
	*           */
    if (invitation.token !== token) {
      throw new HttpsError(
        "permission-denied",
        "This invitation link is invalid."
      );
    }

	/*
	*      * If another anonymous Firebase user already owns this role,
	*           * the current browser may not take it over.
	*                */
    if (
      participant.uid &&
      participant.uid !== participantUid
    ) {
      throw new HttpsError(
        "already-exists",
        `Group ${role} has already been assigned to another browser.`
      );
    }

	/*
	*      * If this same browser already owns the role, allow the
	*           * operation to succeed again. This makes the function
	*                * idempotent and permits refreshing the participant page.
	*                     */
    const alreadyOwnedByCaller =
      participant.uid === participantUid;

    const updates = {};

    updates[
       `sessions/${sessionId}/participants/${role}/uid`
     ] = participantUid;

    updates[
      `sessions/${sessionId}/participants/${role}/claimedAt`
    ] = alreadyOwnedByCaller && participant.claimedAt
      ? participant.claimedAt
      : Date.now();

    updates[
      `sessions/${sessionId}/invitations/${role}/used`
    ] = true;

	/*
	*      * Work out whether both roles will be claimed after this
	*           * update has been applied.
	*                */
    const otherRole = role === "A" ? "B" : "A";
    const otherUid = session.participants?.[otherRole]?.uid;

    const otherRoleClaimed =
      typeof otherUid === "string" &&
      otherUid.length > 0;

    if (otherRoleClaimed) {
      updates[
        `sessions/${sessionId}/public/status`
      ] = "ready";
    }

	/*
	*      * update() applies all of these path changes together.
	*           * Participant assignment, invitation use, and status
	*                * therefore appear as one database update.
	*                     */
    await database.ref().update(updates);

    console.log("Participant role claimed:", {
      sessionId,
      role,
      participantUid,
      alreadyOwnedByCaller,
      bothGroupsClaimed: otherRoleClaimed
    });

    return {
      sessionId,
      role
    };
  }
);

exports.measure = onCall(
  {
    region: REGION
  },
  async (request) => {
    const participantUid = requireAuthentication(request);
    const sessionId = request.data?.sessionId;

    if (
      typeof sessionId !== "string" ||
      !/^[A-Z2-9]{8}$/.test(sessionId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The session ID is invalid."
      );
    }

    const database = getDatabase();
    const sessionRef = database.ref(
      `sessions/${sessionId}`
    );

    let response = null;

    const transactionResult =
      await sessionRef.transaction((session) => {
	/*
	 *  * Realtime Database can call the transaction updater
	 *  * initially with null while establishing local state.
	 *  *
	 *  * Returning the existing value, rather than returning
	 *  * undefined, lets Firebase retry with server data.
	 *  */
        if (session === null) {
          return session;
        }

        const role = getParticipantRole(
          session,
          participantUid
        );

        if (!role) {
          response = {
            error: "not-participant"
          };

	  return;
	}

        if (session.public?.status !== "ready") {
	  response = {
	    error: "session-not-ready"
	  };

	  return;
	}

        const group = session.private?.[role];

        if (!group) {
          response = {
            error: "missing-private-state"
          };

          return;
        }

	/*
	* * A participant may measure only once per round.
	* *
	* * If the same request is repeated after a network
	* * interruption, return the previously stored result.
	* */
        if (group.measured === true) {
          response = {
            ok: true,
            role,
            value: group.result,
            alreadyMeasured: true
          };

          return session;
        }

        const mode = session.public?.mode;

        let result;

        if (mode === "entangled") {
          session.server ??= {};

          const existingSharedResult =
            session.server.sharedResult;

          if (
            existingSharedResult === 0 ||
            existingSharedResult === 1
          ) {
            result = existingSharedResult;
          } else {
            result = randomBit();
            session.server.sharedResult = result;
          }
       } else if (mode === "independent") {
        result = randomBit();
      } else {
        response = {
          error: "invalid-mode"
        };

        return;
      }

      group.measured = true;
      group.result = result;
      group.measuredAt = Date.now();

      const aMeasured =
        session.private?.A?.measured === true;

      const bMeasured =
        session.private?.B?.measured === true;

      session.public.roundReady =
        aMeasured && bMeasured;

	/*
	*   * Record the result under the current round.
	*   */
      const round = session.public?.round;

      session.history ??= {};
      session.history[round] ??= {};

      session.history[round][role] = {
        result,
        measuredAt: group.measuredAt
      };

      response = {
        ok: true,
        role,
        value: result,
        alreadyMeasured: false
      };

      return session;
    });

  if (!transactionResult.committed) {
    throw new HttpsError(
      "aborted",
      "The measurement could not be completed."
    );
  }

  switch (response?.error) {
    case "not-participant":
      throw new HttpsError(
        "permission-denied",
        "You are not a participant in this session."
      );

    case "session-not-ready":
      throw new HttpsError(
        "failed-precondition",
        "Both groups must join before measurements begin."
      );

    case "missing-private-state":
      throw new HttpsError(
        "failed-precondition",
        "The participant state is missing."
      );

    case "invalid-mode":
      throw new HttpsError(
        "failed-precondition",
        "The session has an invalid measurement mode."
    );

    default:
    break;
  }

  if (!response?.ok) {
    throw new HttpsError(
      "internal",
      "The measurement produced no result."
    );
  }

  console.log("Measurement completed:", {
    sessionId,
    role: response.role,
    alreadyMeasured: response.alreadyMeasured
  });

  return response;
  }
);

exports.setEntanglement = onCall(
  {
    region: REGION
  },
  async (request) => {
    const callerUid = requireAuthentication(request);

    const sessionId = request.data?.sessionId;
    const enabled = request.data?.enabled;

    if (
      typeof sessionId !== "string" ||
      !/^[A-Z2-9]{8}$/.test(sessionId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The session ID is invalid."
      );
    }

    if (typeof enabled !== "boolean") {
      throw new HttpsError(
        "invalid-argument",
        "The entanglement setting must be true or false."
      );
    }

    const database = getDatabase();
    const sessionRef = database.ref(
      `sessions/${sessionId}`
    );

    const snapshot = await sessionRef.get();

    if (!snapshot.exists()) {
      throw new HttpsError(
        "not-found",
        "The session does not exist."
      );
    }

    const session = snapshot.val();

    if (session.instructorUid !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "Only the instructor can change entanglement."
      );
    }

    const aMeasured =
      session.private?.A?.measured === true;

    const bMeasured =
      session.private?.B?.measured === true;

    if (aMeasured || bMeasured) {
      throw new HttpsError(
        "failed-precondition",
        "Entanglement cannot be changed during an active round."
      );
    }

    const mode = enabled
      ? "entangled"
      : "independent";

    await database.ref().update({
      [`sessions/${sessionId}/public/mode`]:
        mode,

      [`sessions/${sessionId}/server/sharedResult`]:
        null
    });

    return {
      sessionId,
      mode
    };
  }
);




exports.nextRound = onCall(
  {
    region: REGION
  },
  async (request) => {
    const callerUid = requireAuthentication(request);
    const sessionId = request.data?.sessionId;

    if (
      typeof sessionId !== "string" ||
    !/^[A-Z2-9]{8}$/.test(sessionId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The session ID is invalid."
      );
    }

    const database = getDatabase();
    const sessionRef = database.ref(
      `sessions/${sessionId}`
    );

    const snapshot = await sessionRef.get();

    if (!snapshot.exists()) {
      throw new HttpsError(
        "not-found",
        "The session does not exist."
      );
    }

    const session = snapshot.val();

    if (session.instructorUid !== callerUid) {
      throw new HttpsError(
        "permission-denied",
        "Only the instructor can advance the round."
      );
    }

    const aMeasured =
	session.private?.A?.measured === true;

    const bMeasured =
	session.private?.B?.measured === true;

    if (!aMeasured || !bMeasured) {
      throw new HttpsError(
        "failed-precondition",
        "Both groups must measure before the next round."
      );
    }

    const currentRound = session.public?.round ?? 1;
    const nextRoundNumber = currentRound + 1;

    await database.ref().update({
      [`sessions/${sessionId}/public/round`]:
        nextRoundNumber,

      [`sessions/${sessionId}/public/roundReady`]:
        false,

      [`sessions/${sessionId}/private/A/measured`]:
        false,

      [`sessions/${sessionId}/private/A/result`]:
        null,

      [`sessions/${sessionId}/private/A/measuredAt`]:
        null,

      [`sessions/${sessionId}/private/B/measured`]:
        false,

      [`sessions/${sessionId}/private/B/result`]:
        null,

      [`sessions/${sessionId}/private/B/measuredAt`]:
        null,

      [`sessions/${sessionId}/server/sharedResult`]:
        null
    });

    return {
      sessionId,
      round: nextRoundNumber
    };
  }
);

exports.resumeInstructorSession = onCall(
  {
    region: REGION
  },
  async (request) => {
    const callerUid = requireAuthentication(request);
    const sessionId = request.data?.sessionId;

    /*
    *      * Validate the supplied session ID before using it
    *           * in a database path.
    *                */
    if (
      typeof sessionId !== "string" ||
      !/^[A-Z2-9]{8}$/.test(sessionId)
    ) {
      throw new HttpsError(
        "invalid-argument",
        "The session ID is invalid."
      );
    }

    const database = getDatabase();

    const sessionSnapshot = await database
      .ref(`sessions/${sessionId}`)
      .get();

    if (!sessionSnapshot.exists()) {
      throw new HttpsError(
        "not-found",
       "The saved session no longer exists."
      );
    }

    const session = sessionSnapshot.val();
    /*
     * The current Firebase user must be the same user who
     * originally created the session.
     */
    if (session.instructorUid !== callerUid) {
    throw new HttpsError(
      "permission-denied",
      "This browser is not the instructor for that session."
      );
    }

    const groupAToken =
      session.invitations?.A?.token;

    const groupBToken =
      session.invitations?.B?.token;

    if (
      typeof groupAToken !== "string" ||
      typeof groupBToken !== "string"
    ) {
      throw new HttpsError(
        "failed-precondition",
        "The session invitation records are missing."
      );
    }

    console.log("Instructor session resumed:", {
      sessionId,
      instructorUid: callerUid
    });

    return {
      sessionId,
      groupAToken,
      groupBToken
    };
  }
);


//or cost control, you can set the maximum number of containers that can be
// running at the same time. This helps mitigate the impact of unexpected
// traffic spikes by instead downgrading performance. This limit is a
// per-function limit. You can override the limit for each function using the
// `maxInstances` option in the function's options, e.g.
// `onRequest({ maxInstances: 5 }, (req, res) => { ... })`.
// NOTE: setGlobalOptions does not apply to functions using the v1 API. V1
// functions should each use functions.runWith({ maxInstances: 10 }) instead.
// In the v1 API, each function can only serve one request per container, so
// this will be the maximum concurrent request count.
// setGlobalOptions({ maxInstances: 10 });

// Create and deploy your first functions
// https://firebase.google.com/docs/functions/get-started

// exports.helloWorld = onRequest((request, response) => {
//   logger.info("Hello logs!", {structuredData: true});
//   response.send("Hello from Firebase!");
// });
