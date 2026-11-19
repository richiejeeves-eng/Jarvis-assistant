const loginDb = window.supabase.createClient("https://aelsipdtezvhjkwsshqx.supabase.co","sb_publishable_JbN0kUdtX6d5J8bWAPbz4w_syw2aG4K");
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
loginDb.auth.getSession().then(({data})=>{if(data.session)window.location.replace("index.html");});
document.addEventListener("keydown",event=>{if(event.key==="Enter")jeevesSignIn();});
