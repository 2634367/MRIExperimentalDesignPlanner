// Every call to the server goes through here, so the things that are easy to
// forget -- sending the cookie, attaching the CSRF token, turning a non-2xx
// response into a real Error -- happen once instead of at each call site.
const Api = {
  csrfToken: null,

  async request( path , options ) {
    const settings = options || {};
    const response = await fetch( path , {
      method: settings.method || "GET",
      // The session cookie is the only credential; without this an
      // authenticated request silently arrives as an anonymous one.
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: settings.body ? JSON.stringify( settings.body ) : undefined,
    } );

    let payload = {};
    try {
      payload = await response.json();
    } catch ( parseError ) {
      payload = {};
    }

    if ( !response.ok ) {
      const error = new Error( payload.error || response.statusText );
      error.status = response.status;
      throw error;
    }
    return payload;
  },

  // Any state-changing call carries the per-session CSRF token in the body.
  // Wrapping it here means a new endpoint cannot forget it.
  async post( path , body ) {
    return this.request( path , {
      method: "POST",
      body: Object.assign( {} , body || {} , { csrf_token: this.csrfToken } ),
    } );
  },

  async me() {
    try {
      const payload = await this.request( "/api/me" );
      this.csrfToken = payload.csrf_token;
      return payload;
    } catch ( error ) {
      if ( error.status === 401 ) return { authenticated: false };
      throw error;
    }
  },

  // The one POST with no CSRF token: there is no session yet to hold one.
  // The server guards it by requiring this JSON body instead -- see the
  // login route on the server side.
  login( credential ) {
    return this.request( "/api/login" , { method: "POST" , body: { credential: credential } } );
  },

  // Invite links: no session yet either, so the same JSON-body rule as
  // login() applies. The credential always goes in the body.
  joinInfo( credential )                { return this.request( "/api/join/info" , { method: "POST" , body: { credential: credential } } ); },
  joinMatch( credential , name )        { return this.request( "/api/join/match" , { method: "POST" , body: { credential: credential , display_name: name } } ); },
  joinCreate( credential , name )       { return this.request( "/api/join/create" , { method: "POST" , body: { credential: credential , display_name: name } } ); },
  joinClaim( credential , userId , pin ) {
    return this.request( "/api/join/claim" , { method: "POST" , body: { credential: credential , user_id: userId , pin: pin || "" } } );
  },

  // expect is the name the caller believes is stored. The server refuses
  // with a 409 when it is not, so an undo never overwrites a rename made
  // somewhere else in the meantime.
  rename( displayName , expect ) {
    const body = { display_name: displayName };
    if ( expect !== undefined ) body.expect = expect;
    return this.post( "/api/account/rename" , body );
  },
  setPin( pin )                { return this.post( "/api/account/pin" , { pin: pin } ); },
  createMyLoginLink()          { return this.post( "/api/account/login-link" ); },
  logout()                     { return this.post( "/api/logout" ); },
  listTeam()                   { return this.request( "/api/team" ); },
  listUsers()                  { return this.request( "/api/admin/users" ); },
  createUser( name , role )    { return this.post( "/api/admin/users" , { display_name: name , role: role } ); },
  reissueLogin( userId )       { return this.post( "/api/admin/users/" + userId + "/reissue-login" ); },
  setDisabled( userId , flag ) { return this.post( "/api/admin/users/" + userId + "/disabled" , { disabled: flag } ); },
  revokeAccess( userId )       { return this.post( "/api/admin/users/" + userId + "/revoke-access" ); },
  deleteUser( userId )         { return this.post( "/api/admin/users/" + userId + "/delete" ); },
  listInvites()                { return this.request( "/api/admin/invite-links" ); },
  createInvite( label , maxUses , days ) {
    return this.post( "/api/admin/invite-links" , { label: label , max_uses: maxUses , days: days } );
  },
  revokeInvite( linkId )       { return this.post( "/api/admin/invite-links/" + encodeURIComponent( linkId ) + "/revoke" ); },
  deleteInvite( linkId )       { return this.post( "/api/admin/invite-links/" + encodeURIComponent( linkId ) + "/delete" ); },
  restoreInvite( linkId )      { return this.post( "/api/admin/invite-links/" + encodeURIComponent( linkId ) + "/restore" ); },

  // API keys. createKey's expiresInDays is passed through as-is including null,
  // because the server reads absent as "use the default" and 0 as "never
  // expires" -- collapsing them here would lose the distinction.
  listKeys()                   { return this.request( "/api/keys" ); },
  createKey( name , role , expiresInDays ) {
    return this.post( "/api/keys" , { name: name , role: role , expires_in_days: expiresInDays } );
  },
  revokeKey( keyId )           { return this.post( "/api/keys/" + encodeURIComponent( keyId ) + "/revoke" ); },
  deleteKey( keyId )           { return this.post( "/api/keys/" + encodeURIComponent( keyId ) + "/delete" ); },
  restoreKey( keyId )          { return this.post( "/api/keys/" + encodeURIComponent( keyId ) + "/restore" ); },
  listAllKeys()                { return this.request( "/api/admin/keys" ); },
  revokeAnyKey( keyId )        { return this.post( "/api/admin/keys/" + encodeURIComponent( keyId ) + "/revoke" ); },
  deleteAnyKey( keyId )        { return this.post( "/api/admin/keys/" + encodeURIComponent( keyId ) + "/delete" ); },
  restoreAnyKey( keyId )       { return this.post( "/api/admin/keys/" + encodeURIComponent( keyId ) + "/restore" ); },

  // Scanner cards: the shared library (see static/js/scanners.js).
  cardPath( id )               { return "/api/scanner-cards/" + encodeURIComponent( id ); },
  listScannerCards()           { return this.request( "/api/scanner-cards" ); },
  createScannerCard( card )    { return this.post( "/api/scanner-cards" , { card: card } ); },
  saveScannerCard( id , card , baseRevision ) {
    return this.post( this.cardPath( id ) + "/save" , { card: card , base_revision: baseRevision } );
  },
  cardBackups( id )            { return this.request( this.cardPath( id ) + "/backups" ); },
  restoreCardBackup( id , revision ) { return this.post( this.cardPath( id ) + "/backups/restore" , { revision: revision } ); },
  deleteScannerCard( id )      { return this.post( this.cardPath( id ) + "/delete" ); },
  restoreScannerCard( id )     { return this.post( this.cardPath( id ) + "/restore" ); },

  // Experiments. A save sends the revision it was made from; a 409 means
  // someone else saved first (see Doc.save).
  experimentPath( id )         { return "/api/experiments/" + encodeURIComponent( id ); },
  listExperiments()            { return this.request( "/api/experiments" ); },
  createExperiment( doc )      { return this.post( "/api/experiments" , { doc: doc } ); },
  getExperiment( id )          { return this.request( this.experimentPath( id ) ); },
  saveExperiment( id , doc , baseRevision ) {
    return this.post( this.experimentPath( id ) + "/save" , { doc: doc , base_revision: baseRevision } );
  },
  duplicateExperiment( id , name ) { return this.post( this.experimentPath( id ) + "/duplicate" , { name: name } ); },
  setEditors( id , editors )   { return this.post( this.experimentPath( id ) + "/editors" , { editors: editors } ); },
  deleteExperiment( id )       { return this.post( this.experimentPath( id ) + "/delete" ); },
  restoreExperiment( id )      { return this.post( this.experimentPath( id ) + "/restore" ); },
  mediaFromUrl( id , url )     { return this.post( this.experimentPath( id ) + "/media/url" , { url: url } ); },
  listShareLinks( id )         { return this.request( this.experimentPath( id ) + "/share-links" ); },
  createShareLink( id , label ) { return this.post( this.experimentPath( id ) + "/share-links" , { label: label } ); },
  revokeShareLink( id , linkId ) {
    return this.post( this.experimentPath( id ) + "/share-links/" + encodeURIComponent( linkId ) + "/revoke" );
  },

  // A picture is uploaded as the raw file, so the CSRF token goes in a header.
  async uploadMedia( id , file ) {
    const response = await fetch( this.experimentPath( id ) + "/media" , {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/octet-stream" , "X-CSRF-Token": this.csrfToken || "" },
      body: file,
    } );
    let payload = {};
    try { payload = await response.json(); } catch ( parseError ) { payload = {}; }
    if ( !response.ok ) {
      const error = new Error( payload.error || response.statusText );
      error.status = response.status;
      throw error;
    }
    return payload;
  },

  // A zip, as a Blob, with the file name the server chose.
  async postForFile( path , body ) {
    const response = await fetch( path , {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify( body ),
    } );
    if ( !response.ok ) {
      let payload = {};
      try { payload = await response.json(); } catch ( parseError ) { payload = {}; }
      const error = new Error( payload.error || response.statusText );
      error.status = response.status;
      throw error;
    }
    const disposition = response.headers.get( "content-disposition" ) || "";
    const match = disposition.match( /filename="([^"]+)"/ );
    return { blob: await response.blob() , filename: match ? match[ 1 ] : "experiment.zip" };
  },
  bundle( id , plans ) {
    return this.postForFile( this.experimentPath( id ) + "/bundle" , { plans: plans , csrf_token: this.csrfToken } );
  },

  // The report zip (or report.xlsx alone): body is { tables, methods, figures, only }.
  report( id , body ) {
    return this.postForFile( this.experimentPath( id ) + "/report" , Object.assign( { csrf_token: this.csrfToken } , body ) );
  },
  sharedReport( credential , body ) { return this.postForFile( "/api/share/report" , Object.assign( { credential: credential } , body ) ); },

  // Share links: no session, so the credential goes in the body.
  openShared( credential )     { return this.request( "/api/share/open" , { method: "POST" , body: { credential: credential } } ); },
  sharedBundle( credential , plans ) { return this.postForFile( "/api/share/bundle" , { credential: credential , plans: plans } ); },

  // PsychoPy on this machine.
  publish( id , body )         { return this.post( this.experimentPath( id ) + "/publish" , body ); },
  published( id )              { return this.request( this.experimentPath( id ) + "/published" ); },
  seen( id , participant )     { return this.post( this.experimentPath( id ) + "/seen" , { participant: participant } ); },
  addSeen( id , runs )         { return this.post( this.experimentPath( id ) + "/seen/add" , { runs: runs } ); },
  psychopyStatus( refresh )    { return this.request( "/api/psychopy" + ( refresh ? "?refresh=1" : "" ) ); },
  launch( id , body )          { return this.post( this.experimentPath( id ) + "/launch" , body ); },
  latestLaunch()               { return this.request( "/api/launches/latest" ); },
  getLaunch( launchId )        { return this.request( "/api/launches/" + encodeURIComponent( launchId ) ); },
  stopLaunch( launchId )       { return this.post( "/api/launches/" + encodeURIComponent( launchId ) + "/stop" ); },
};
