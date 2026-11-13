// Wires the design screens together. Each screen (experiments.js,
// overview.js, prompts.js, media.js, trials.js, runs.js, sessions.js,
// results.js, hrfview.js, report.js) owns
// its own render( root ); this file decides when they run:
//
//   - after every change to the open experiment (Doc.on), the screen on
//     show repaints and the others are marked stale, to repaint when shown;
//   - the sidebar's experiment group appears only while one is open, headed
//     with its name, and the navbar badge counts what Validate finds wrong;
//   - a share link (/s/<credential>) opens the same screens read-only, with
//     no account and nothing else.
const Designer = {
  screens: {},
  stale: {},
  // Screens that need an open experiment.
  docScreens: [ "overview" , "prompts" , "pictures" , "trials" , "runs" , "sessions" , "results" , "hrf" , "report" , "settings" ],

  register() {
    [ Experiments , Overview , Prompts , MediaLibrary , Trials , Runs , Sessions , Results , HrfView , Report , Settings , Scanners ].forEach( ( screen ) => {
      this.screens[ screen.name ] = screen;
      this.stale[ screen.name ] = true;
    } );
    Doc.on( ( reason ) => {
      Object.keys( this.stale ).forEach( ( name ) => { this.stale[ name ] = true; } );
      this.chrome();
      // A rename moves the address to the new name.
      if ( reason !== "open" && Doc.isOpen() && !Doc.readOnly && Nav.where().slug ) Nav.noteItem( Nav.item() );
      if ( reason === "open" ) {
        Experiments.loadLinks();
        Nav.refresh();
        this.followLink();
      }
      this.refresh();
    } );
    window.addEventListener( "nav" , async () => {
      await this.followSlug();
      this.followLink();
      this.refresh( true );
      this.noteItem();
    } );
    Dom.get( "conflict-reload" ).addEventListener( "click" , () => Doc.reloadTheirs() );
    Dom.get( "conflict-keep" ).addEventListener( "click" , () => Doc.keepMine() );
    Dom.get( "gone-leave" ).addEventListener( "click" , () => Doc.leaveGone() );
  },

  // Everyone an experiment could be shared with. /api/team answers a page at a
  // time ({ members , next }), and the editor picker needs all of them.
  async loadTeam() {
    const members = [];
    let offset = 0;
    while ( offset !== null && offset !== undefined ) {
      const page = await Api.listTeam( offset );
      members.push( ...page.members );
      offset = page.next;
    }
    return members;
  },

  async init( me ) {
    this.register();
    Experiments.team = await this.loadTeam().catch( () => [] );
    Dom.show( document.querySelector( '.view[data-view="scanners"]' ) , true );
    // Runs and scan steps pick from the card library, so it loads up front.
    Scanners.load().then( () => {
      Object.keys( this.stale ).forEach( ( name ) => { this.stale[ name ] = true; } );
      this.refresh();
    } );
    await Experiments.load();
    const legacy = this.legacyAddress();
    const where = Nav.where();
    let wanted = legacy.id || this.lastOpened();
    if ( where.slug ) {
      wanted = Experiments.idOf( where.slug );
      if ( !wanted ) {
        Dom.toast( I18n.get( "experiments.no_such" ) , "error" );
        window.history.replaceState( null , "" , "/experiments" );
      }
    }
    if ( wanted && Experiments.rows.some( ( row ) => row.id === wanted ) ) {
      try {
        const row = await Api.getExperiment( wanted );
        Doc.open( row );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    }
    this.chrome();
    Dom.show( Dom.get( "sidebar-design" ) , true );
    // "/" (just signed in, or the brand link) opens the experiment last open,
    // or the list; an old /?e=<id>#screen/item link opens what it named.
    if ( !Nav.where().screen ) {
      const screen = legacy.screen || ( Doc.isOpen() ? "overview" : "experiments" );
      const doc = Nav.docScreens.includes( screen );
      window.history.replaceState( null , "" , doc && !Doc.isOpen() ? "/experiments" : Nav.url( screen , legacy.item ) + legacy.card );
    }
    Doc.follow();
  },

  // The addresses before paths: /?e=<id>#screen/item, or #card on its own.
  legacyAddress() {
    const found = { id: "" , screen: "" , item: "" , card: "" };
    if ( window.location.pathname !== "/" ) return found;
    found.id = new URLSearchParams( window.location.search ).get( "e" ) || "";
    const hash = window.location.hash.replace( /^#/ , "" ).split( "/" );
    let name = "";
    try { name = decodeURIComponent( hash[ 0 ] || "" ); } catch ( error ) { name = ""; }
    if ( Nav.topScreens.includes( name ) || Nav.docScreens.includes( name ) ) {
      found.screen = name;
      try { found.item = decodeURIComponent( hash[ 1 ] || "" ); } catch ( error ) { found.item = ""; }
    } else if ( name ) {
      // A card (#two-factor-panel): it is on Account.
      found.screen = "account";
      found.card = "#" + name;
    }
    return found;
  },

  // Back or Forward to another experiment's address opens that experiment.
  async followSlug() {
    const where = Nav.where();
    if ( !where.slug || Doc.readOnly || ( Doc.isOpen() && Experiments.slugOf( Doc.id ) === where.slug ) ) return;
    const id = Experiments.idOf( where.slug );
    if ( !id ) {
      Dom.toast( I18n.get( "experiments.no_such" ) , "error" );
      Nav.go( "/experiments" , { replace: true } );
      return;
    }
    try {
      await Doc.flush();
      Undo.clear();
      Doc.open( await Api.getExperiment( id ) );
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  lastOpened() {
    try {
      return window.localStorage.getItem( "last-experiment" );
    } catch ( error ) {
      return null;
    }
  },

  // A share link: the design, read-only, and nothing else.
  async initShared( credential ) {
    this.register();
    let row;
    try {
      row = await Api.openShared( credential );
    } catch ( error ) {
      Dom.show( Dom.get( "share-invalid" ) , true );
      return false;
    }
    Doc.open( { id: row.id , revision: row.revision , doc: row.doc , name: row.name } , { readOnly: true , shareCredential: credential } );
    document.documentElement.classList.add( "read-only" );
    Dom.show( Dom.get( "signed-in" ) , true );
    Dom.show( Dom.get( "share-banner" ) , true );
    Dom.text( Dom.get( "share-banner-text" ) , I18n.get( "share.banner" ).replace( "{name}" , row.name ) );
    // Only the design screens; no account, no experiments list, and no
    // results, which name participants.
    Dom.all( "#sidebar-nav > .nav-link, #sidebar-admin, #sidebar-you, [data-nav=\"experiments\"], [data-nav=\"scanners\"], [data-nav=\"results\"]" ).forEach( ( node ) => node.remove() );
    Dom.all( '.view[data-view="experiments"], .view[data-view="scanners"], .view[data-view="account"], .view[data-view="appearance"], .view[data-view="pin"], .view[data-view="api-keys"], .view[data-view="results"]' ).forEach( ( node ) => node.remove() );
    Nav.fallback = "overview";
    this.chrome();
    Dom.show( Dom.get( "sidebar-design" ) , true );
    if ( !Nav.where().screen ) window.history.replaceState( null , "" , "/s/" + encodeURIComponent( credential ) + "/overview" );
    Doc.follow();
    return true;
  },

  // The parts of the page around the screens that follow the document.
  chrome() {
    const open = Doc.isOpen();
    this.docScreens.forEach( ( name ) => {
      const section = document.querySelector( '.view[data-view="' + name + '"]' );
      if ( section ) section.hidden = !open;
    } );
    Dom.show( Dom.get( "sidebar-experiment" ) , open );
    // Scanner cards: last in the Setup section while an experiment is open,
    // right under the experiment group (so under Experiments) when not.
    const scanners = document.querySelector( '#sidebar-design [data-nav="scanners"]' );
    if ( scanners ) {
      if ( open ) Dom.get( "sidebar-setup" ).appendChild( scanners );
      else Dom.get( "sidebar-experiment" ).after( scanners );
    }
    const name = Dom.get( "sidebar-experiment-name" );
    Dom.text( name , open ? Doc.doc.name || I18n.get( "experiments.untitled" ) : "" );
    name.title = name.textContent;
    const badge = Dom.get( "problems-badge" );
    if ( open ) {
      const problems = Validate.check( Doc.doc );
      const errors = problems.filter( ( p ) => p.level === "error" ).length;
      Dom.show( badge , problems.length > 0 );
      badge.className = "btn btn-sm problems-badge " + ( errors ? "btn-danger" : "btn-warning" );
      Dom.text( Dom.get( "problems-count" ) , String( problems.length ) );
      badge.title = I18n.get( "problems.badge_title" );
    } else {
      Dom.show( badge , false );
    }
    Doc.showSaveState( Doc.conflict ? "conflict" : Doc.dirty ? "pending" : "saved" );
  },

  // One screen changed outside the open document (the scanner card
  // library): repaint it now if it is showing, else when it is next shown.
  repaint( name ) {
    this.stale[ name ] = true;
    if ( typeof Nav !== "undefined" && Nav.current() === name ) this.refresh();
  },

  // Open the item a link names (/<slug>/sessions/<id>), once, when the link is
  // followed: from then on the screen's own selection is what counts.
  followLink() {
    if ( typeof Nav === "undefined" ) return;
    const name = Nav.current();
    const screen = this.screens[ name ];
    const id = Nav.item();
    if ( !screen || !screen.focus || !id ) return;
    screen.focus( id );
    this.stale[ name ] = true;
  },

  // Keep the address on the item showing. A library still loading has
  // nothing selected yet, and must keep the id a link asked for until it has.
  noteItem() {
    const name = Nav.current();
    const screen = this.screens[ name ];
    if ( !screen || !screen.current || screen.loaded === false ) return;
    if ( this.docScreens.includes( name ) && !Doc.isOpen() ) return;
    const item = screen.current();
    Nav.noteItem( item ? item.id : "" );
  },

  // Repaint the screen on show (if it changed since it was last painted).
  refresh( onlyIfStale ) {
    if ( typeof Nav === "undefined" ) return;
    const name = Nav.current();
    const screen = this.screens[ name ];
    if ( !screen ) return;
    if ( onlyIfStale && !this.stale[ name ] ) return;
    if ( this.docScreens.includes( name ) && !Doc.isOpen() ) return;
    const root = Dom.get( "screen-" + name );
    if ( !root ) return;
    this.stale[ name ] = false;
    try {
      Ui.keep( root , () => screen.render( root ) );
      this.noteItem();
    } catch ( error ) {
      console.error( error );
      root.replaceChildren( Dom.el( "div" , { class: "alert alert-danger" , text: I18n.get( "errors.render" ) + " " + error.message } ) );
    }
  },

  // Validate's findings as links to where each one is fixed.
  problemList( problems ) {
    if ( !problems.length ) return Dom.el( "div" , { class: "alert alert-success py-2" , text: I18n.get( "problems.none" ) } );
    const list = Dom.el( "div" , { class: "list-group" } );
    problems.forEach( ( problem ) => {
      const link = Dom.el( "a" , { class: "list-group-item list-group-item-action d-flex gap-2 align-items-start" , attrs: { href: "#" + problem.screen } , children: [
        Dom.el( "i" , { class: "bi " + ( problem.level === "error" ? "bi-x-circle text-danger" : "bi-exclamation-triangle text-warning" ) } ),
        Dom.el( "span" , { text: problem.text } ),
      ] } );
      link.addEventListener( "click" , () => {
        const screen = this.screens[ problem.screen ];
        if ( screen && screen.focus && problem.id ) screen.focus( problem.id );
        this.stale[ problem.screen ] = true;
      } );
      list.appendChild( link );
    } );
    return list;
  },
};
