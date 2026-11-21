async function signUp() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  if (!email || password.length < 6) {
    showStatus("Enter an email and a password of at least 6 characters.");
    return;
  }

  const { error } = await db.auth.signUp({
    email: email,
    password: password,
    options: { emailRedirectTo: window.location.origin + window.location.pathname }
  });

  if (error) {
    showStatus("Sign up error: " + error.message);
    return;
  }

  showStatus("Check your email and tap the confirmation link, then come back here and tap Sign in.");
}

async function signIn() {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await db.auth.signInWithPassword({
    email: email,
    password: password
  });

  if (error) {
    showStatus("Sign in error: " + error.message);
    return;
  }

  document.getElementById("password").value = "";
}

async function signOut() {
  await db.auth.signOut();
}

async function forgotPassword() {
  const email = document.getElementById("email").value.trim();

  if (!email) {
    showStatus("Type your email above first, then tap Forgot password.");
    return;
  }

  const { error } = await db.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname
  });

  if (error) {
    showStatus("Reset error: " + error.message);
    return;
  }

  showStatus("If that email has an account, a reset link is on its way. Tap it, then follow the steps here.");
}

async function setNewPassword() {
  const password = document.getElementById("password").value;

  if (password.length < 6) {
    showStatus("Type a new password of at least 6 characters in the password box.");
    return;
  }

  const { error } = await db.auth.updateUser({ password: password });

  if (error) {
    showStatus("Password error: " + error.message);
    return;
  }

  document.getElementById("password").value = "";
  const setButton = document.getElementById("setpw");
  if (setButton) setButton.style.display = "none";
  showStatus("● Password updated. You are signed in.");
}

db.auth.onAuthStateChange((event, session) => {
  const account = document.getElementById("account");

  if (event === "PASSWORD_RECOVERY") {
    account.hidden = false;
    account.open = true;
    const setButton = document.getElementById("setpw");
    if (setButton) setButton.style.display = "inline-block";
    showStatus("Type a new password in the password box, then tap Set new password.");
    return;
  }

  if (session) {
    showStatus("● Signed in as " + session.user.email);
    account.open = false;
  } else {
    showStatus("Not signed in. Tap to sign in.");
    account.open = true;
  }
  setTimeout(checkAlerts, 0);
});