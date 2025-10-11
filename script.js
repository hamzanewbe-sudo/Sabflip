import { initializeApp } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-app.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-auth.js";
import { getFirestore, collection, query, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.6.1/firebase-firestore.js";

// --- GLOBAL VARIABLES (Provided by Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';

// Use a fallback for firebaseConfig, which will be checked inside the init loop
let firebaseConfig = null;
try {
    // Attempt to access and parse the global variable immediately
    if (typeof __firebase_config !== 'undefined' && __firebase_config) {
        firebaseConfig = JSON.parse(__firebase_config);
    }
} catch (e) {
    console.warn("Could not parse initial __firebase_config.");
}
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- API Endpoints ---
const USER_DATA_API_ENDPOINT = '/api/user-data';
const GENERATE_CODE_API_ENDPOINT = '/api/generate-code';
const VERIFY_USER_API_ENDPOINT = '/api/verify-user';

// --- Firebase API Access (Assumed to be globally available via CDN links in index.html) ---
const initializeApp = window.firebase ? window.firebase.initializeApp : () => console.error("Firebase App not available.");
const getAuth = window.firebase ? window.firebase.auth.getAuth : () => null;
const signInWithCustomToken = window.firebase ? window.firebase.auth.signInWithCustomToken : () => console.error("Auth not available.");
const signInAnonymously = window.firebase ? window.firebase.auth.signInAnonymously : () => console.error("Auth not available.");
const onAuthStateChanged = window.firebase ? window.firebase.auth.onAuthStateChanged : () => console.error("Auth not available.");
const getFirestore = window.firebase ? window.firebase.firestore.getFirestore : () => null;
const getIdToken = (user) => user ? user.getIdToken() : Promise.resolve(null);

// Global Firebase instances and User ID
let app;
let db;
let auth;
let userId = null;
let currentRobloxUsername = null;
let isProcessing = false;

// --- UI Elements Selectors (Cached lookups for efficiency) ---
const D_MODAL = () => document.getElementById('verification-modal');
const D_STEP_1 = () => document.getElementById('modal-content-step-1');
const D_STEP_2 = () => document.getElementById('modal-content-step-2');
const D_USERNAME_INPUT = () => document.getElementById('roblox-username-input');
const D_CODE_DISPLAY = () => document.getElementById('verification-code-display');
const D_GENERATE_BTN = () => document.getElementById('generate-code-button');
const D_VERIFY_BTN = () => document.getElementById('verify-account-button');
const D_MESSAGE_AREA = () => document.getElementById('modal-message-area');
const D_MESSAGE_TEXT = () => document.getElementById('modal-message-text');
const D_NETWORK_STATUS = () => document.getElementById('network-status');


// --- UI Management Functions ---

function showVerificationModal() {
    clearModalMessages();
    const modal = D_MODAL();
    if (modal) modal.classList.remove('hidden');
    const step1 = D_STEP_1();
    if (step1) step1.classList.remove('hidden');
    const step2 = D_STEP_2();
    if (step2) step2.classList.add('hidden');
}

function hideVerificationModal() {
    const modal = D_MODAL();
    if (modal) modal.classList.add('hidden');
    clearModalMessages();
}

function showModalMessage(message, isError) {
    const area = D_MESSAGE_AREA();
    const text = D_MESSAGE_TEXT();
    if (area && text) {
        text.textContent = message;
        area.classList.remove('hidden', 'bg-red-900/40', 'bg-green-900/40', 'text-red-400', 'text-green-400');

        if (isError) {
            area.classList.add('bg-red-900/40', 'text-red-400');
        } else {
            area.classList.add('bg-green-900/40', 'text-green-400');
        }
        area.classList.remove('hidden');
        setTimeout(clearModalMessages, 5000);
    }
}

function clearModalMessages() {
    const area = D_MESSAGE_AREA();
    if (area) {
        area.classList.add('hidden');
    }
}

function setButtonLoading(button, isLoading) {
    isProcessing = isLoading;
    button.disabled = isLoading;
    const originalText = button.getAttribute('data-original-text') || 'Submit';
    button.innerHTML = isLoading ? '<i class="fas fa-spinner fa-spin"></i> Processing...' : originalText;
}

function hideLoadingOverlay() {
    const loader = document.getElementById('loading-overlay');
    if (loader) {
        setTimeout(() => {
            loader.style.display = 'none';
        }, 500);
    }
}

// --- Network Status Logic ---

function updateNetworkStatus() {
    const statusElement = D_NETWORK_STATUS();
    if (!statusElement) return;

    if (navigator.onLine) {
        statusElement.classList.remove('border-red-500', 'text-red-400', 'bg-red-900/20');
        statusElement.classList.add('border-green-500', 'text-green-400', 'bg-green-900/20');
        statusElement.innerHTML = '<i class="fas fa-plug mr-2"></i> CONNECTED';
    } else {
        statusElement.classList.remove('border-green-500', 'text-green-400', 'bg-green-900/20');
        statusElement.classList.add('border-red-500', 'text-red-400', 'bg-red-900/20');
        statusElement.innerHTML = '<i class="fas fa-times-circle mr-2"></i> DISCONNECTED';
    }
}

// --- API Interaction Functions ---

async function fetchUserData(user) {
    try {
        const idToken = await getIdToken(user);

        // FIX: Use clean proxy path
        const response = await fetch(USER_DATA_API_ENDPOINT, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${idToken}`, 'Content-Type': 'application/json' }
        });

        const data = await response.json();

        if (!response.ok) {
            if (data.requiresVerification) {
                return { requiresVerification: true };
            }
            throw new Error(data.error || `API call failed: ${response.statusText}`);
        }
        return data;

    } catch (error) {
        console.error("Error fetching user data from API:", error);
        return null;
    }
}


// --- Main Application Flow Logic ---

// --- CRITICAL STABILITY FIX: Initialize Firebase robustly ---
async function initializeFirebase() {
    // 1. Check if Firebase is already initialized
    if (app) return;

    // 2. Poll for firebaseConfig to appear (up to 5 seconds)
    const MAX_RETRIES = 50;
    let retryCount = 0;
    let localConfig = firebaseConfig;

    // This loop prevents initializeApp from running until the environment has injected the config keys
    while (!localConfig && retryCount < MAX_RETRIES) {
        try {
            if (typeof __firebase_config !== 'undefined') {
                localConfig = JSON.parse(__firebase_config);
                firebaseConfig = localConfig; // Update global reference
            }
        } catch (e) {
            console.warn("Retrying config parse...");
        }

        if (localConfig) break;

        await new Promise(resolve => setTimeout(resolve, 100)); // Wait 100ms
        retryCount++;
    }

    if (!localConfig) {
        console.error("Firebase config is missing after retry. Cannot initialize.");
        showModalMessage("Firebase configuration error. Please ensure the app is configured.", true);
        return;
    }

    // 3. Initialize Firebase now that config is guaranteed
    try {
        app = initializeApp(localConfig);
        db = getFirestore(app);
        auth = getAuth(app);

        await (initialAuthToken ? signInWithCustomToken(auth, initialAuthToken) : signInAnonymously(auth));

        hideLoadingOverlay();

        onAuthStateChanged(auth, async (user) => {
            if (user) {
                userId = user.uid;
                const userData = await fetchUserData(user);

                if (userData && userData.requiresVerification) {
                    handleUserLogout();
                    console.log("User signed into Firebase but needs Roblox verification.");
                } else if (userData) {
                    handleUserLogin(userData);
                } else {
                    handleUserLogout();
                }
            } else {
                userId = null;
                handleUserLogout();
            }
        });

        setupEventListeners();
        updateNetworkStatus();

    } catch (error) {
        console.error("Error during Firebase initialization or sign-in:", error);
        hideLoadingOverlay();
        handleUserLogout();
        setupEventListeners();
    }
}
// --- END CRITICAL STABILITY FIX ---


function handleUserLogin(userData) {
    console.log(`User logged in and verified: ${userData.username}`);
    hideVerificationModal();

    const pfpUrl = userData.pfpUrl || "https://placehold.co/40x40/ff8c40/1e293b?text=R";
    const balance = userData.balance || 0;
    const username = userData.username || "SabflipUser";

    const profileCardHTML = (isMobile) => `
        <div id="profile-card-${isMobile ? 'mobile' : 'desktop'}" class="flex items-center gap-3 rounded-xl border border-gray-700 bg-card p-2 shadow-lg glow-on-hover transition-all duration-300 cursor-pointer">
            <img id="user-pfp" src="${pfpUrl}" alt="Roblox PFP" class="h-10 w-10 rounded-full border-2 border-primary object-cover" onerror="this.onerror=null; this.src='https://placehold.co/40x40/ff8c40/1e293b?text=R';">
            <div class="flex flex-col text-right">
                <div id="user-balance" class="flex items-center justify-end text-lg font-bold text-white">
                    <i class="fas fa-gem text-primary mr-2"></i> ${balance.toLocaleString()}
                </div>
                <div id="user-name" class="text-xs font-semibold text-gray-400">${username}</div>
            </div>
        </div>
    `;

    document.getElementById('login-profile-container-desktop').innerHTML = profileCardHTML(false);
    document.getElementById('login-profile-container-mobile').innerHTML = profileCardHTML(true);

    const chatInput = document.querySelector('.chat-input');
    const sendButton = document.querySelector('.send-button');
    if (chatInput) chatInput.disabled = false;
    if (sendButton) sendButton.disabled = false;
    if (chatInput) chatInput.placeholder = "Say something...";
}

function handleUserLogout() {
    const loginButtonHTML = (isDesktop) => `
        <button id="login-trigger-btn-${isDesktop ? 'desktop' : 'mobile'}" class="inline-flex items-center justify-center gap-2 bg-primary h-10 py-2 rounded-lg px-8 font-semibold text-gray-900 hover:opacity-90 glow-on-hover">
            <i class="fas fa-sign-in-alt"></i> Login
        </button>
    `;

    document.getElementById('login-profile-container-desktop').innerHTML = loginButtonHTML(true);
    document.getElementById('login-profile-container-mobile').innerHTML = loginButtonHTML(false);

    const chatInput = document.querySelector('.chat-input');
    const sendButton = document.querySelector('.send-button');
    if (chatInput) chatInput.disabled = true;
    if (sendButton) sendButton.disabled = true;
    if (chatInput) chatInput.placeholder = "Login to start chatting!";

    setupLoginButtonListeners();
}

// --- Verification Step Handlers ---

async function handleGenerateCode() {
    if (isProcessing) return;

    const username = D_USERNAME_INPUT().value.trim();
    if (!username) {
        showModalMessage("Please enter your Roblox username.", true);
        return;
    }
    if (!auth || !auth.currentUser) {
        showModalMessage("Authentication error. Please refresh and try again.", true);
        return;
    }

    setButtonLoading(D_GENERATE_BTN(), true);
    clearModalMessages();

    try {
        const user = auth.currentUser;
        const idToken = await getIdToken(user);

        // FIX: Send the username in the JSON body as a POST request
        const response = await fetch(GENERATE_CODE_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ robloxUsername: username })
        });

        const data = await response.json();

        if (response.ok) {
            currentRobloxUsername = username;
            D_CODE_DISPLAY().textContent = data.code;

            D_STEP_1().classList.add('hidden');
            D_STEP_2().classList.remove('hidden');
            showModalMessage(`Code generated successfully! Displayed username: ${username}`, false);
        } else {
            showModalMessage(data.error || "Failed to generate code. Please try again.", true);
        }

    } catch (error) {
        console.error("Error generating code:", error);
        showModalMessage("A critical error occurred. Check console.", true);
    } finally {
        setButtonLoading(D_GENERATE_BTN(), false);
    }
}

async function handleVerifyAccount() {
    if (isProcessing) return;

    if (!currentRobloxUsername) {
        showModalMessage("Verification process requires restarting. Please go back to Step 1.", true);
        return;
    }
    if (!auth || !auth.currentUser) {
        showModalMessage("Authentication error. Please refresh and try again.", true);
        return;
    }

    setButtonLoading(D_VERIFY_BTN(), true);
    clearModalMessages();

    try {
        const user = auth.currentUser;
        const idToken = await getIdToken(user);
        const code = D_CODE_DISPLAY().textContent; // Get code from display

        // FIX: Send verification data via POST body
        const response = await fetch(VERIFY_USER_API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ robloxUsername: currentRobloxUsername, code: code })
        });

        const data = await response.json();

        if (response.ok && data.success) {
            showModalMessage(data.message, false);

            // Successfully verified. Force the user object to reload its claims
            auth.currentUser.reload().then(() => {
                auth.currentUser.getIdToken(true).then(() => {
                    // NOTE: data here may not contain the full user data, so we reload from fetchUserData
                    fetchUserData(auth.currentUser).then(verifiedData => {
                        if (verifiedData) {
                            handleUserLogin(verifiedData);
                        } else {
                            showModalMessage("Verification success, but failed to load user data.", true);
                        }
                    });
                });
            });

        } else {
            showModalMessage(data.error || "Verification failed. Check your Roblox About section.", true);
        }

    } catch (error) {
        console.error("Error verifying account:", error);
        showModalMessage("A critical error occurred during verification.", true);
    } finally {
        setButtonLoading(D_VERIFY_BTN(), false);
    }
}


// --- Event Listener Setup ---

function setupLoginButtonListeners() {
    const loginTriggers = [
        document.getElementById('login-trigger-btn-desktop'),
        document.getElementById('login-trigger-btn-mobile')
    ];

    loginTriggers.forEach(btn => {
        if (btn) {
            btn.removeEventListener('click', showVerificationModal);
            btn.addEventListener('click', showVerificationModal);
        }
    });
}

function setupEventListeners() {
    // Modal buttons
    const modal = D_MODAL();
    if (modal) {
        const closeBtn = document.getElementById('close-modal-button');
        if (closeBtn) closeBtn.addEventListener('click', hideVerificationModal);
        const generateBtn = D_GENERATE_BTN();
        if (generateBtn) generateBtn.addEventListener('click', handleGenerateCode);
        const verifyBtn = D_VERIFY_BTN();
        if (verifyBtn) verifyBtn.addEventListener('click', handleVerifyAccount);
    }

    setupLoginButtonListeners();

    // Network status listeners
    window.addEventListener('online', updateNetworkStatus);
    window.addEventListener('offline', updateNetworkStatus);
}


// --- Main Execution ---

document.addEventListener('DOMContentLoaded', initializeFirebase);
