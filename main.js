import "./style.css";

import firebase from "firebase/app";
import "firebase/analytics";
import "firebase/firestore";
import * as firebaseui from "firebaseui";
import "firebaseui/dist/firebaseui.css";

const firebaseConfig = {
  apiKey: "AIzaSyABumQe78iRPmjiu3zYjnMZegoK2uVAF7U",
  authDomain: "webrtcchat-6ef76.firebaseapp.com",
  databaseURL: "https://webrtcchat-6ef76-default-rtdb.firebaseio.com",
  projectId: "webrtcchat-6ef76",
  storageBucket: "webrtcchat-6ef76.appspot.com",
  messagingSenderId: "837441346533",
  appId: "1:837441346533:web:ef3e65d5d053646f04ed0c",
  measurementId: "G-FYQEM2PRNC",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
firebase.analytics();

var ui = new firebaseui.auth.AuthUI(firebase.auth());

ui.start("#firebaseui-auth-container", {
  signInSuccessUrl: "/",

  signInOptions: [
    // List of OAuth providers supported.
    firebase.auth.GoogleAuthProvider.PROVIDER_ID,
  ],
  signInFlow: "popup",
  callbacks: {
    signInSuccessWithAuthResult: function (user, credential, redirectUrl) {
      if (window.opener) {
        // The widget has been opened in a popup, so close the window
        // and return false to not redirect the opener.
        window.close();
        return false;
      } else {
        // The widget has been used in redirect mode, so we redirect to the signInSuccessUrl.
        return true;
      }
    },
    uiShown: function () {
      // The widget is rendered.
      // Hide the loader.
      document.getElementById("loader").style.display = "none";
    },
  },
  // Other config options...
});

const initApp = function () {
  document.getElementById("sign-out").addEventListener("click", function () {
    firebase.auth().signOut();
  });
  firebase.auth().onAuthStateChanged(
    function (user) {
      if (user) {
        // User is signed in.
        document.getElementById("login").style.display = "none";
        document.getElementById("main").style.display = "block";
        document.getElementById("name").textContent = user.displayName;
        document.getElementById("email").textContent = user.email;
        if (user.photoURL) {
          var photoURL = user.photoURL;
          // Append size to the photo URL for Google hosted images to avoid requesting
          // the image with its original resolution (using more bandwidth than needed)
          // when it is going to be presented in smaller size.
          if (
            photoURL.indexOf("googleusercontent.com") != -1 ||
            photoURL.indexOf("ggpht.com") != -1
          ) {
            photoURL =
              photoURL + "?sz=" + document.getElementById("photo").clientHeight;
          }
          document.getElementById("photo").src = photoURL;
          document.getElementById("photo").style.display = "block";
        } else {
          document.getElementById("photo").style.display = "none";
        }
      } else {
        document.getElementById("login").style.display = "block";
        document.getElementById("main").style.display = "none";
      }
    },
    function (error) {
      console.log(error);
    }
  );
};

window.addEventListener("load", function () {
  initApp();
});

const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;

// HTML elements
const webcamButton = document.getElementById("webcamButton");
const webcamVideo = document.getElementById("webcamVideo");
const callButton = document.getElementById("callButton");
const callInput = document.getElementById("callInput");
const answerButton = document.getElementById("answerButton");
const remoteVideo = document.getElementById("remoteVideo");
const hangupButton = document.getElementById("hangupButton");

webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({
    video: true,
    audio: true,
  });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
};

// 2. Create an offer
callButton.onclick = async () => {
  // Reference Firestore collections for signaling
  const callDoc = firestore.collection("calls").doc();
  const offerCandidates = callDoc.collection("offerCandidates");
  const answerCandidates = callDoc.collection("answerCandidates");

  callInput.value = callDoc.id;

  // Get candidates for caller, save to db
  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  // Create offer
  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  // Listen for remote answer
  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
    hangupButton.disabled = false;
  });

  // When answered, add candidate to peer connection
  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === "added") {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  answerButton.disabled = true;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection("calls").doc(callId);
  const answerCandidates = callDoc.collection("answerCandidates");
  const offerCandidates = callDoc.collection("offerCandidates");

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      console.log(change);
      if (change.type === "added") {
        let data = change.doc.data();
        pc.addIceCandidate(new RTCIceCandidate(data));
      }
    });
  });
  answerButton.disabled = true;
  hangupButton.disabled = false;
};

// hang up call

hangupButton.onclick = async () => {
  callButton.disabled = true;
  hangupButton.disabled = true;
  answerButton.disabled = true;
  webcamButton.disabled = false;
  localStream.getTracks().forEach((track) => track.stop());
  localStream = null;
  remoteStream.getTracks().forEach((track) => track.stop());
  remoteStream = null;
  pc.close();
  callInput.value = null;
};
