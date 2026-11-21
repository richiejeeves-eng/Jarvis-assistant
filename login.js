const loginDb = window.supabase.createClient(window.JEEVES_CONFIG.supabaseUrl,window.JEEVES_CONFIG.supabasePublishableKey);
const loginSession = document.getElementById("login-session");
const loginForm = document.getElementById("login-form");
const loginCurrent = document.getElementById("login-current");
function showLoginSession(session){
  const signedIn = !!session;
  loginSession.hidden = !signedIn;
  loginForm.hidden = signedIn;
  if(signedIn) loginCurrent.textContent = "Currently signed in as " + session.user.email + ". Sign out to use a different account.";
}
const loginMessage = (message) => { document.getElementById("login-message").textContent = message; };
const loginEmail = () => document.getElementById("login-email").value.trim();
const loginPassword = () => document.getElementById("login-password").value;
async function jeevesSignIn(){
  if(!loginEmail() || !loginPassword()){loginMessage("Enter your email address and password.");return;}
  const {error}=await loginDb.auth.signInWithPassword({email:loginEmail(),password:loginPassword()});
  if(error){loginMessage("Sign-in failed: "+error.message);return;}
  loginMessage("Signed in. Opening your private workspace…");
  window.location.replace("index.html");
}
async function jeevesSignUp(){
  if(!loginEmail() || loginPassword().length<6){loginMessage("Enter an email and a password of at least 6 characters.");return;}
  const {error}=await loginDb.auth.signUp({email:loginEmail(),password:loginPassword(),options:{emailRedirectTo:window.location.origin+window.location.pathname.replace(/login\.html$/,"index.html")}});
  loginMessage(error?"Sign-up failed: "+error.message:"Check your email for the confirmation link, then return here to sign in.");
}
async function jeevesForgotPassword(){
  if(!loginEmail()){loginMessage("Enter your email address first.");return;}
  const {error}=await loginDb.auth.resetPasswordForEmail(loginEmail(),{redirectTo:window.location.origin+window.location.pathname.replace(/login\.html$/,"index.html")});
  loginMessage(error?"Password reset failed: "+error.message:"If that email has an account, a password reset link is on its way.");
}
async function jeevesSignOut(){
  const {error}=await loginDb.auth.signOut();
  if(error){loginMessage("Sign-out failed: "+error.message);return;}
  showLoginSession(null);
  loginMessage("Signed out. You can now sign in with another account.");
}
loginDb.auth.getSession().then(({data})=>showLoginSession(data.session));
loginDb.auth.onAuthStateChange((_event,session)=>showLoginSession(session));
document.addEventListener("keydown",event=>{if(event.key==="Enter")jeevesSignIn();});
