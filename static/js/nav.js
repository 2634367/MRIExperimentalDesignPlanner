// The sidebar: which signed-in screen is showing, and the address that names it.
//
// Every screen is a <section class="view" data-view="name"> in index.html and
// has an address of its own:
//
//   /account, /logs, /scanners/<card>     a screen that stands on its own
//   /<experiment-slug>/overview           a screen of one experiment
//   /<experiment-slug>/trials/<id>        ...and the item open on it
//   /s/<credential>/runs                  a screen of a share link
//
// The address is the only state -- back, forward, reload and a pasted link
// all land on the same screen. Links are ordinary hrefs; a click on one this
// page handles moves with history.pushState instead of a reload, and every
// move fires a "nav" event on window for the screens that follow it. The
// server answers each of these addresses with the same page (app/core/pages.py
// has the same lists as below; keep them in step).
//
// A hash can still name a card on a screen (/account#two-factor-panel), and
// /two-factor (a screen that became a card on Account, see moved) opens the
// screen it is on and scrolls to it, so old links and bookmarks still work.
// So do the old /?e=<id>#screen/item addresses: Designer.init rewrites them.
//
// Whether a screen exists for this user is not decided here. The screen's own
// file un-hides its section (Keys.init shows the All API keys screen, and only
// if the server has them switched on); Nav only offers what was un-hidden. So
// app.js calls Nav.init() last, once every screen has had its say.
const Nav = {
  fallback: "experiments",
  // Matches Bootstrap's lg breakpoint, where offcanvas-lg becomes a column.
  wide: window.matchMedia( "(min-width: 992px)" ),
  // Collapsed-or-not is a per-browser convenience, like the theme.
  storageKey: "sidebar-collapsed",
  // Screens that are now cards on Account: old name -> the card's id.
  moved: {
    "password": "password-panel",
    "pin": "pin-panel",
    "two-factor": "two-factor-panel",
    "api-keys": "api-keys-panel",
  },
  topScreens: [ "experiments" , "scanners" , "account" , "appearance" , "shortcuts" , "files" , "about" ,
    "users" , "invite-links" , "all-keys" , "logs" , "jobs" , "webhooks" , "app-settings" ,
    "password" , "pin" , "two-factor" , "api-keys" ],
  docScreens: [ "overview" , "prompts" , "pictures" , "trials" , "runs" , "sessions" , "results" , "hrf" , "report" , "settings" ],
  // First path parts an experiment slug may not be (pages.py RESERVED).
  reserved: [ "api" , "s" , "login" , "join" , "js" , "css" , "vendor" , "mcp" , "metrics" , "media" ,
    "index.html" , "favicon.ico" , "robots.txt" , "wsu-mark.svg" ],
  started: false,

  init() {
    Dom.all( "[data-nav]" ).forEach( ( link ) => {
      link.addEventListener( "click" , () => this.closeSidebar() );
    } );
    this.offerLinks();
    // Before the sidebar appears, so a collapsed one never flashes open.
    this.setCollapsed( this.savedCollapsed() );
    Dom.show( Dom.get( "sidebar" ) , true );
    const toggle = Dom.get( "sidebar-toggle" );
    toggle.addEventListener( "click" , () => this.toggleSidebar() );
    Dom.show( toggle , true );

    // Moving between screens is not an undo step: Back and Forward already
    // are that, and an undo that only changed the screen would get in the way
    // of undoing what was done on it.
    document.addEventListener( "click" , ( event ) => this.onClick( event ) );
    window.addEventListener( "popstate" , () => this.changed() );
    // A link to a card on this screen (#two-factor-panel) only changes the hash.
    window.addEventListener( "hashchange" , () => this.changed() );
    this.started = true;
    this.render();
  },

  isReserved( slug ) {
    return this.reserved.includes( slug ) || this.topScreens.includes( slug ) || this.docScreens.includes( slug );
  },

  // What an address names: { base , slug , screen , item }. base is
  // "/s/<credential>" on a share link, slug the experiment's, and screen ""
  // when the address names no screen ("/", or something unknown).
  where( pathname ) {
    const raw = String( pathname === undefined ? window.location.pathname : pathname ).split( "/" ).filter( Boolean );
    const part = ( text ) => {
      try {
        return decodeURIComponent( text || "" );
      } catch ( error ) {
        return "";
      }
    };
    const none = { base: "" , slug: "" , screen: "" , item: "" };
    if ( raw[ 0 ] === "s" && raw[ 1 ] ) {
      const screen = part( raw[ 2 ] );
      return { base: "/s/" + raw[ 1 ] , slug: "" , screen: this.docScreens.includes( screen ) ? screen : "" , item: part( raw[ 3 ] ) };
    }
    const first = part( raw[ 0 ] );
    if ( this.topScreens.includes( first ) && raw.length <= 2 ) return { base: "" , slug: "" , screen: first , item: part( raw[ 1 ] ) };
    const second = part( raw[ 1 ] );
    if ( raw.length >= 2 && raw.length <= 3 && this.docScreens.includes( second ) && !this.isReserved( first ) ) {
      return { base: "" , slug: first , screen: second , item: part( raw[ 2 ] ) };
    }
    return none;
  },

  // Whether this page handles an address itself (a link to it moves with
  // pushState rather than a reload).
  handles( pathname ) {
    return this.where( pathname ).screen !== "";
  },

  // The address of a screen: of the open experiment for a design screen
  // (slug overrides which), of the share link on one, and item names the
  // thing open on it.
  url( screen , item , slug ) {
    const base = this.where().base;
    let path;
    if ( base ) path = base + "/" + screen;
    else if ( this.docScreens.includes( screen ) ) {
      const which = slug !== undefined ? slug : ( typeof Experiments !== "undefined" && typeof Doc !== "undefined" && Doc.isOpen() ? Experiments.slugOf( Doc.id ) : "" );
      if ( !which ) return "/" + this.fallback;
      path = "/" + which + "/" + screen;
    } else path = "/" + screen;
    return item ? path + "/" + encodeURIComponent( item ) : path;
  },

  // Move to an address this page handles: a new history step, or with
  // options.replace the same one.
  go( url , options ) {
    const replace = Boolean( options && options.replace );
    const here = window.location.pathname + window.location.search + window.location.hash;
    if ( url !== here ) window.history[ replace ? "replaceState" : "pushState" ]( null , "" , url );
    this.changed();
  },

  // The address moved: the sidebar follows, then whoever listens.
  changed() {
    this.render();
    window.dispatchEvent( new Event( "nav" ) );
  },

  // A plain left click on a link to one of this page's addresses.
  onClick( event ) {
    if ( event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) return;
    const link = event.target instanceof Element ? event.target.closest( "a[href]" ) : null;
    if ( !link || link.target || link.hasAttribute( "download" ) ) return;
    const href = link.getAttribute( "href" );
    if ( href.charAt( 0 ) === "#" ) return;
    const url = new URL( link.href , window.location.href );
    if ( url.origin !== window.location.origin || !this.handles( url.pathname ) ) return;
    event.preventDefault();
    this.go( url.pathname + url.hash );
  },

  // Show the links whose screens exist right now. A group heading with
  // nothing left under it goes too.
  offerLinks() {
    Dom.all( "[data-nav]" ).forEach( ( link ) => {
      Dom.show( link , this.available( link.getAttribute( "data-nav" ) ) );
    } );
    Dom.all( ".sidebar-group" ).forEach( function ( group ) {
      Dom.show( group , Dom.all( "[data-nav]:not([hidden])" , group ).length > 0 );
    } );
    this.linkHrefs();
  },

  // A design screen's link names the open experiment, so it changes with it.
  linkHrefs() {
    Dom.all( "[data-nav], [data-nav-link]" ).forEach( ( link ) => {
      const href = this.url( link.getAttribute( "data-nav" ) || link.getAttribute( "data-nav-link" ) );
      if ( link.getAttribute( "href" ) !== href ) link.setAttribute( "href" , href );
    } );
  },

  // For screens that come and go after start-up -- the design screens
  // appear when an experiment is opened.
  refresh() {
    this.offerLinks();
    this.render();
  },

  // Undo uses this to go back to the screen an action happened on.
  show( name ) {
    this.go( this.url( name ) );
  },

  available( name ) {
    const view = document.querySelector( '.view[data-view="' + name + '"]' );
    return Boolean( view ) && !view.hidden;
  },

  // An address naming a screen this user does not have (an admin link opened
  // by a non-admin, a design screen with no experiment open) shows the
  // fallback screen rather than nothing.
  current() {
    const name = this.where().screen;
    if ( this.available( name ) ) return name;
    const card = this.card( name );
    return card ? card.closest( ".view" ).getAttribute( "data-view" ) : this.fallback;
  },

  // The card a name or hash names, when it sits on a screen this user has
  // and is itself showing. null for a screen's own name, or anything else.
  card( name ) {
    const id = Object.prototype.hasOwnProperty.call( this.moved , name ) ? this.moved[ name ] : name;
    const card = id ? document.getElementById( id ) : null;
    const view = card && card.closest( ".view" );
    if ( !view || view === card || card.hidden ) return null;
    return this.available( view.getAttribute( "data-view" ) ) ? card : null;
  },

  // The id after the screen's name, or "".
  item() {
    return this.where().item;
  },

  // Keep the address on what is showing, without a new history step (each
  // pick in a list is not a place to go Back to). Also how a renamed
  // experiment's address follows its new name.
  noteItem( id ) {
    const url = this.url( this.current() , id );
    if ( window.location.pathname !== url ) window.history.replaceState( null , "" , url + window.location.hash );
    this.linkHrefs();
  },

  render() {
    const name = this.current();
    // An address that names nothing showing ("/", a design screen with no
    // experiment open, a screen this user does not have) is put right, so
    // the address bar never names another screen than the one on show.
    if ( this.started ) {
      const where = this.where();
      const keep = where.screen === name || ( where.screen && this.card( where.screen ) );
      if ( !keep ) window.history.replaceState( null , "" , this.url( name ) + window.location.hash );
    }
    Track.nav( name );
    Dom.all( ".view" ).forEach( function ( view ) {
      view.classList.toggle( "view-active" , view.getAttribute( "data-view" ) === name );
    } );
    Dom.all( "[data-nav]" ).forEach( function ( link ) {
      const active = link.getAttribute( "data-nav" ) === name;
      link.classList.toggle( "active" , active );
      if ( active ) link.setAttribute( "aria-current" , "page" );
      else link.removeAttribute( "aria-current" );
    } );
    this.linkHrefs();
    const card = this.card( window.location.hash.replace( /^#/ , "" ) ) || this.card( this.where().screen );
    if ( card ) Dom.reveal( card , "start" );
    else {
      Dom.movedOnPurpose();
      window.scrollTo( 0 , 0 );
    }
    this.announce( name );
  },

  // Changing screen reloads nothing, so nothing tells a screen reader or the
  // browser's tab that anything happened. The title names the screen, and the
  // focus moves to its heading, except on load, when it belongs to the page.
  announce( name ) {
    const heading = document.querySelector( '.view[data-view="' + name + '"] h2' );
    if ( !heading ) return;
    const title = I18n.get( "nav.page_title" );
    if ( title !== "" ) document.title = title.replace( "{screen}" , heading.textContent ).replace( "{app}" , I18n.get( "app.title" ) );
    const moved = this.shown !== undefined && this.shown !== name;
    this.shown = name;
    if ( !moved ) return;
    heading.setAttribute( "tabindex" , "-1" );
    heading.focus( { preventScroll: true } );
  },

  // The menu button: on a wide screen it folds the sidebar column away and
  // back; on a phone it slides the panel in and out. Only the folding is
  // undoable: the phone panel is gone again as soon as a screen is picked.
  toggleSidebar() {
    if ( this.wide.matches ) {
      const collapsed = !document.documentElement.classList.contains( "sidebar-collapsed" );
      Undo.run( {
        label: I18n.get( "undo.sidebar" ),
        screen: null,
        do: () => this.saveCollapsed( collapsed ),
        undo: () => this.saveCollapsed( !collapsed ),
      } );
    } else if ( window.bootstrap ) {
      bootstrap.Offcanvas.getOrCreateInstance( Dom.get( "sidebar" ) ).toggle();
    }
  },

  setCollapsed( collapsed ) {
    document.documentElement.classList.toggle( "sidebar-collapsed" , collapsed );
    Dom.get( "sidebar-toggle" ).setAttribute( "aria-expanded" , String( !collapsed ) );
  },

  saveCollapsed( collapsed ) {
    this.setCollapsed( collapsed );
    try {
      if ( collapsed ) window.localStorage.setItem( this.storageKey , "1" );
      else window.localStorage.removeItem( this.storageKey );
    } catch ( error ) { /* storage blocked: it just is not remembered */ }
  },

  savedCollapsed() {
    try {
      return window.localStorage.getItem( this.storageKey ) === "1";
    } catch ( error ) {
      return false;
    }
  },

  // On a phone the sidebar is a slide-in panel; picking a screen closes it,
  // including the one already showing (which changes no hash).
  closeSidebar() {
    const panel = window.bootstrap && bootstrap.Offcanvas.getInstance( Dom.get( "sidebar" ) );
    if ( panel ) panel.hide();
  },
};
