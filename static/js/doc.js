// The experiment that is open, and the only way to change it.
//
// Every edit goes through Doc.change( label , fn ): fn changes the document
// in place, Doc snapshots it before and after, records the pair with Undo
// (so Ctrl+Z / Ctrl+Y work on every screen), repaints whoever listens, and
// saves a moment later. Saves carry the revision they were made from; when
// someone else (another tab, a teammate, an agent) saved in between, the
// server answers 409 and the conflict banner offers to reload theirs or keep
// this one -- nothing is overwritten silently.
//
// A share link opens a document read-only: change() refuses, and nothing is
// ever saved.
const Doc = {
  id: null,
  revision: 0,
  doc: null,
  row: null,
  readOnly: false,
  shareCredential: "",
  listeners: [],
  saveTimer: 0,
  saving: false,
  dirty: false,
  conflict: false,
  SAVE_DELAY: 700,

  on( listener ) {
    this.listeners.push( listener );
  },

  emit( reason ) {
    this.listeners.forEach( ( listener ) => {
      try {
        listener( reason );
      } catch ( error ) {
        console.error( error );
      }
    } );
  },

  isOpen() {
    return this.doc !== null;
  },

  open( row , options ) {
    const settings = options || {};
    this.id = row.id;
    this.revision = row.revision;
    this.row = row;
    this.doc = Schema.normalise( row.doc );
    this.readOnly = Boolean( settings.readOnly );
    this.shareCredential = settings.shareCredential || "";
    this.dirty = false;
    this.setConflict( false );
    if ( !this.readOnly ) {
      try { window.localStorage.setItem( "last-experiment" , row.id ); } catch ( error ) { /* not remembered */ }
      const url = new URL( window.location.href );
      url.searchParams.set( "e" , row.id );
      window.history.replaceState( null , "" , url.pathname + url.search + url.hash );
    }
    this.emit( "open" );
  },

  close() {
    this.id = null;
    this.doc = null;
    this.row = null;
    const url = new URL( window.location.href );
    url.searchParams.delete( "e" );
    window.history.replaceState( null , "" , url.pathname + url.search + url.hash );
    this.emit( "open" );
  },

  snapshot() {
    return JSON.stringify( this.doc );
  },

  // label reads after "Undone:" ("trial type renamed"). options.merge folds
  // quick repeats (a slider, a stepper) into one undo step.
  change( label , fn , options ) {
    if ( !this.doc ) return;
    if ( this.readOnly ) {
      Dom.toast( I18n.get( "share.read_only" ) , "error" );
      return;
    }
    const settings = options || {};
    const id = this.id;
    const before = this.snapshot();
    fn( this.doc );
    this.doc = Schema.normalise( this.doc );
    const after = this.snapshot();
    if ( before === after ) return;
    this.touch( settings.reason || "change" );
    Undo.record( {
      label: label,
      merge: settings.merge,
      toast: Boolean( settings.toast ),
      undo: () => this.restore( id , before ),
      redo: () => this.restore( id , after ),
    } );
  },

  restore( id , text ) {
    if ( id !== this.id ) throw new Error( I18n.get( "undo.other_experiment" ) );
    this.doc = Schema.normalise( JSON.parse( text ) );
    this.touch( "undo" );
  },

  touch( reason ) {
    this.dirty = true;
    this.emit( reason );
    this.scheduleSave();
  },

  scheduleSave() {
    window.clearTimeout( this.saveTimer );
    this.saveTimer = window.setTimeout( () => this.save() , this.SAVE_DELAY );
    this.showSaveState( "pending" );
  },

  async save() {
    if ( !this.doc || this.readOnly || this.conflict ) return;
    if ( this.saving ) {
      this.scheduleSave();
      return;
    }
    if ( !this.dirty ) return;
    this.saving = true;
    this.dirty = false;
    const id = this.id;
    this.showSaveState( "saving" );
    try {
      const result = await Api.saveExperiment( id , this.doc , this.revision );
      if ( id === this.id ) {
        this.revision = result.revision;
        this.row.name = this.doc.name;
      }
      this.showSaveState( this.dirty ? "pending" : "saved" );
    } catch ( error ) {
      this.dirty = true;
      if ( error.status === 409 ) {
        this.setConflict( true );
      } else {
        this.showSaveState( "error" );
        Dom.toast( I18n.get( "doc.save_failed" ) + " " + error.message , "error" );
        window.clearTimeout( this.saveTimer );
        this.saveTimer = window.setTimeout( () => this.save() , 5000 );
      }
    } finally {
      this.saving = false;
    }
  },

  // Before leaving the page, or switching experiments.
  async flush() {
    window.clearTimeout( this.saveTimer );
    if ( this.dirty ) await this.save();
  },

  showSaveState( state ) {
    const badge = Dom.get( "save-state" );
    if ( !badge ) return;
    Dom.show( badge , Boolean( this.doc ) && !this.readOnly );
    badge.className = "badge save-state save-" + state;
    Dom.text( badge , I18n.get( "doc.state_" + state ) );
  },

  setConflict( on ) {
    this.conflict = on;
    Dom.show( Dom.get( "conflict-banner" ) , on );
    if ( on ) this.showSaveState( "conflict" );
  },

  // The conflict banner's two answers.
  async reloadTheirs() {
    const row = await Api.getExperiment( this.id );
    Undo.clear();
    this.open( row );
    Dom.toast( I18n.get( "doc.reloaded" ) , "ok" );
  },

  async keepMine() {
    const row = await Api.getExperiment( this.id );
    this.revision = row.revision;
    this.setConflict( false );
    this.dirty = true;
    await this.save();
  },

  // -- reading helpers every screen uses ------------------------------------

  mediaUrl( sha ) {
    const entry = this.doc && this.doc.media.find( ( m ) => m.id === sha );
    if ( !entry ) return "";
    const file = entry.id + "." + entry.ext;
    if ( this.shareCredential ) return "/s/" + encodeURIComponent( this.shareCredential ) + "/media/" + file;
    return "/api/experiments/" + encodeURIComponent( this.id ) + "/media/" + file;
  },

  find( collection , id ) {
    return this.doc ? this.doc[ collection ].find( ( x ) => x.id === id ) || null : null;
  },

  // "Untitled trial type 2": the name a new thing gets.
  nextName( collection , key ) {
    const base = I18n.get( key );
    const names = new Set( this.doc[ collection ].map( ( x ) => x.name ) );
    if ( !names.has( base ) ) return base;
    let n = 2;
    while ( names.has( base + " " + n ) ) n += 1;
    return base + " " + n;
  },
};

window.addEventListener( "beforeunload" , ( event ) => {
  if ( Doc.dirty && !Doc.readOnly ) {
    Doc.save();
    event.preventDefault();
  }
} );
