// The Scanner cards screen: the team's shared library of sequences, each the
// parameter pages the console shows (INFO PAGE, GEOMETRY, ...). One library
// for everyone, kept on the server (app/models/scanner_cards.py), and open
// whether or not an experiment is.
//
// A run picks a card for its TR, and a session's scan step for its length.
// Each keeps a snapshot of those numbers (Scanners.ref), so a plan, a share
// link and the runner never need the library; when the card changes later,
// the run or step offers to update from it.
//
// Every edit saves on its own (one save at a time per card, with the same
// revision check as an experiment) and is one undo step.
const Scanners = {
  name: "scanners",
  ROLES: [ "functional" , "reference" , "structural" , "other" ],
  cards: [],
  loaded: false,
  selected: null,
  page: 0,
  filter: "",
  // Per card: the save in flight, and whether another is wanted after it.
  saving: {},

  async load() {
    try {
      this.cards = await Api.listScannerCards();
      this.loaded = true;
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  byId( id ) {
    return this.cards.find( ( c ) => c.id === id ) || null;
  },

  current() {
    if ( !this.cards.some( ( c ) => c.id === this.selected ) ) this.selected = this.cards.length ? this.cards[ 0 ].id : null;
    return this.byId( this.selected );
  },

  focus( id ) {
    this.selected = id;
    this.page = 0;
  },

  // -- reading the numbers out of a card's rows ---------------------------

  find( card , parameter ) {
    const target = parameter.toLowerCase();
    for ( const page of card.pages ) {
      const row = page.rows.find( ( r ) => r.parameter.trim().toLowerCase() === target );
      if ( row ) return String( row.value );
    }
    return "";
  },

  // "MM:SS.s" or "HH:MM:SS" -> seconds.
  seconds( text ) {
    const parts = String( text || "" ).trim().split( ":" ).map( Number );
    if ( !parts.length || parts.some( ( n ) => !Number.isFinite( n ) ) ) return 0;
    return parts.reduce( ( sum , n ) => sum * 60 + n , 0 );
  },

  summary( card ) {
    const numbers = this.find( card , "Act. TR/TE (ms)" ).match( /\d*\.?\d+/g ) || [];
    const duration = this.find( card , "Total scan duration" );
    return {
      duration: duration,
      seconds: this.seconds( duration ),
      tr_ms: numbers.length ? Number( numbers[ 0 ] ) : 0,
      te_ms: numbers.length > 1 ? Number( numbers[ 1 ] ) : 0,
      voxel: this.find( card , "ACQ voxel MPS (mm)" ),
      slices: this.find( card , "slices" ),
      mb: this.find( card , "MB Factor" ),
      flip: this.find( card , "Flip angle (deg)" ),
      dynamics: this.find( card , "dyn scans" ),
      dummies: this.find( card , "dummy scans" ),
    };
  },

  // What a run or scan step keeps of a card. TR only for a functional or
  // reference card: a structural "TR" is per excitation, not per volume.
  ref( card ) {
    const s = this.summary( card );
    const volumeTr = card.role === "functional" || card.role === "reference";
    return { id: card.id , label: card.label , tr: volumeTr ? s.tr_ms / 1000 : 0 , seconds: Math.round( s.seconds * 10 ) / 10 };
  },

  // A snapshot whose card has since changed (or gone), for "update from card".
  stale( snapshot ) {
    if ( !snapshot || !this.loaded ) return false;
    const card = this.byId( snapshot.id );
    if ( !card ) return false;
    const fresh = this.ref( card );
    return fresh.label !== snapshot.label || fresh.tr !== snapshot.tr || fresh.seconds !== snapshot.seconds;
  },

  // A select of the library's cards, by role; "" is "none".
  select( value , noneLabel , onCommit , options ) {
    const list = [ [ "" , noneLabel ] ];
    this.ROLES.forEach( ( role ) => this.cards.filter( ( c ) => c.role === role ).forEach( ( c ) => list.push( [ c.id , c.label ] ) ) );
    if ( value && !this.byId( value ) ) list.push( [ value , Ui.t( "scanners.missing" ) ] );
    return Ui.select( value || "" , list , onCommit , options );
  },

  label( seconds ) {
    return seconds ? Timing.clock( seconds ) : "–";
  },

  // -- saving ---------------------------------------------------------------

  // Replace a card's content locally, repaint, and save it.
  put( id , card ) {
    const index = this.cards.findIndex( ( c ) => c.id === id );
    if ( index < 0 ) throw new Error( Ui.t( "scanners.gone" ) );
    this.cards[ index ] = Object.assign( {} , this.cards[ index ] , JSON.parse( JSON.stringify( card ) ) );
    Designer.repaint( this.name );
    this.save( id );
  },

  async save( id ) {
    const state = this.saving[ id ] || ( this.saving[ id ] = { busy: false , again: false } );
    if ( state.busy ) {
      state.again = true;
      return;
    }
    state.busy = true;
    try {
      do {
        state.again = false;
        const card = this.byId( id );
        if ( !card ) break;
        const row = await Api.saveScannerCard( id , this.content( card ) , card.revision );
        const now = this.byId( id );
        if ( now ) {
          now.revision = row.revision;
          now.updated_at = row.updated_at;
        }
      } while ( state.again );
    } catch ( error ) {
      Dom.toast( ( error.status === 409 ? Ui.t( "scanners.conflict" ) : error.message ) , "error" );
      if ( error.status === 409 ) {
        await this.load();
        Designer.repaint( this.name );
      }
    } finally {
      state.busy = false;
    }
  },

  content( card ) {
    return { label: card.label , role: card.role , note: card.note , pages: card.pages };
  },

  // One edit to the selected card: fn changes a copy, which is saved, and
  // the change is one undo step.
  edit( label , fn , options ) {
    const card = this.current();
    if ( !card ) return;
    const id = card.id;
    const before = this.content( card );
    const after = JSON.parse( JSON.stringify( before ) );
    fn( after );
    if ( JSON.stringify( before ) === JSON.stringify( after ) ) return;
    this.put( id , after );
    const settings = options || {};
    Undo.record( {
      label: label , toast: Boolean( settings.toast ) , merge: settings.merge,
      undo: () => this.put( id , before ),
      redo: () => this.put( id , after ),
    } );
  },

  async create( card , undoLabel ) {
    try {
      const row = await Api.createScannerCard( card );
      this.cards.push( row );
      this.focus( row.id );
      Designer.repaint( this.name );
      Undo.record( {
        label: undoLabel,
        undo: () => this.remove( row.id ),
        redo: () => this.restore( row.id ),
      } );
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  async remove( id ) {
    await Api.deleteScannerCard( id );
    this.cards = this.cards.filter( ( c ) => c.id !== id );
    Designer.repaint( this.name );
  },

  async restore( id ) {
    const row = await Api.restoreScannerCard( id );
    this.cards.push( row );
    this.focus( row.id );
    Designer.repaint( this.name );
  },

  blank() {
    const row = ( parameter , value ) => ( { parameter: parameter , value: value , indent: 0 } );
    return {
      label: Ui.t( "scanners.new_name" ) , role: "functional" , note: "",
      pages: [
        { name: "INFO PAGE" , rows: [ row( "Total scan duration" , "05:00.0" ) , row( "Act. TR/TE (ms)" , "2000 / 30" ) , row( "ACQ voxel MPS (mm)" , "2.50 / 2.50 / 2.50" ) ] },
        { name: "GEOMETRY" , rows: [ row( "slices" , "36" ) , row( "Flip angle (deg)" , "75" ) ] },
        { name: "DYN/ANG" , rows: [ row( "dyn scans" , "150" ) , row( "dummy scans" , "4" ) ] },
      ],
    };
  },

  // Where the open experiment uses a card.
  usedBy( id ) {
    return Doc.isOpen() ? Validate.usages( Doc.doc , "scanner" , id ) : [];
  },

  markdown( card ) {
    const lines = [ "# " + card.label , "" ];
    if ( card.note ) lines.push( card.note , "" );
    card.pages.forEach( ( page ) => {
      lines.push( "## " + page.name , "" , "| Parameter | Value |" , "| --- | --- |" );
      page.rows.forEach( ( r ) => lines.push( "| " + "  ".repeat( r.indent ) + r.parameter.replace( /\|/g , "\\|" ) + " | " + String( r.value ).replace( /\|/g , "\\|" ) + " |" ) );
      lines.push( "" );
    } );
    return lines.join( "\n" );
  },

  // -- the screen -------------------------------------------------------------

  render( root ) {
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "scanners.description" ) ) );
    if ( !this.loaded ) {
      root.appendChild( Ui.muted( Ui.t( "scanners.loading" ) ) );
      this.load().then( () => Designer.repaint( this.name ) );
      return;
    }
    const card = this.current();
    const left = Dom.el( "div" , { class: "col-lg-4 col-xxl-3" } );
    this.ROLES.forEach( ( role ) => {
      const cards = this.cards.filter( ( c ) => c.role === role );
      if ( !cards.length ) return;
      left.appendChild( Dom.el( "div" , { class: "sidebar-heading mt-2 mb-1" , text: Ui.t( "scanners.role_" + role ) } ) );
      left.appendChild( Ui.picker( cards.map( ( c ) => {
        const s = this.summary( c );
        return { id: c.id , name: c.label , meta: [ s.tr_ms ? s.tr_ms + " ms" : "" , s.duration ].filter( Boolean ).join( " · " ) };
      } ) , this.selected , ( id ) => {
        this.focus( id );
        Designer.repaint( this.name );
      } , { stacked: true } ) );
    } );
    left.appendChild( Dom.el( "div" , { class: "mt-2" , children: [ Ui.button( Ui.t( "scanners.new" ) , "plus-lg" , () => this.create( this.blank() , Ui.t( "undo.card_added" ) ) , { variant: "btn-outline-primary" } ) ] } ) );
    const right = Dom.el( "div" , { class: "col-lg-8 col-xxl-9" } );
    right.appendChild( card ? this.editor( card ) : Ui.empty( Ui.t( "scanners.none" ) ) );
    root.appendChild( Dom.el( "div" , { class: "row g-3" , children: [ left , right ] } ) );
  },

  editor( card ) {
    const box = Dom.el( "div" );
    const usedBy = this.usedBy( card.id );
    const about = Dom.el( "div" );
    about.appendChild( Ui.row( [
      Ui.field( "scanners.label" , Ui.text( card.label , ( v ) => this.edit( Ui.t( "undo.card_renamed" ) , ( c ) => { c.label = v.trim() || c.label; } ) , { key: "card.label" , maxlength: 200 } ) , { col: "col-md-6" } ),
      Ui.field( "scanners.role" , Ui.select( card.role , this.ROLES.map( ( r ) => [ r , Ui.t( "scanners.role_" + r ) ] ) , ( v ) => this.edit( Ui.t( "undo.card_changed" ) , ( c ) => { c.role = v; } ) , { key: "card.role" } ) , { col: "col-md-6" } ),
      Ui.field( "scanners.note" , Ui.textarea( card.note , ( v ) => this.edit( Ui.t( "undo.card_changed" ) , ( c ) => { c.note = v; } ) , { key: "card.note" , rows: 2 } ) , { col: "col-12" } ),
    ] ) );

    // The numbers a planner looks at first.
    const s = this.summary( card );
    const stats = Dom.el( "div" , { class: "stat-grid" } );
    const stat = ( label , value , sub ) => stats.appendChild( Dom.el( "div" , { class: "stat stat-compact" , children: [
      Dom.el( "div" , { class: "stat-label" , text: label } ), Dom.el( "div" , { class: "stat-value" , text: value || "–" } ),
      Dom.el( "div" , { class: "stat-sub" , text: sub || "" } ),
    ] } ) );
    stat( Ui.t( "scanners.stat_duration" ) , s.duration , s.dynamics ? Ui.t( "scanners.stat_dynamics" ).replace( "{n}" , s.dynamics ) : "" );
    stat( Ui.t( "scanners.stat_tr_te" ) , s.tr_ms ? s.tr_ms + " / " + s.te_ms : "" , "ms" );
    stat( Ui.t( "scanners.stat_voxel" ) , s.voxel , "mm" );
    stat( Ui.t( "scanners.stat_slices" ) , s.slices , s.mb ? "MB " + s.mb : "" );
    stat( Ui.t( "scanners.stat_flip" ) , s.flip ? s.flip + "°" : "" , s.dummies ? Ui.t( "scanners.stat_dummies" ).replace( "{n}" , s.dummies ) : "" );
    if ( usedBy.length ) about.appendChild( Ui.muted( Ui.t( "scanners.used_by" ) + " " + usedBy.join( ", " ) , "mt-2" ) );
    box.appendChild( Ui.section( Ui.t( "scanners.section_card" ) , about ) );
    box.appendChild( Ui.section( Ui.t( "scanners.section_summary" ) , stats ) );

    const actions = Dom.el( "div" , { class: "row-actions mt-3" } );
    actions.appendChild( Ui.button( Ui.t( "ui.duplicate" ) , "files" , () => {
      const copy = this.content( card );
      copy.label = card.label + " " + Ui.t( "ui.copy_suffix" );
      this.create( JSON.parse( JSON.stringify( copy ) ) , Ui.t( "undo.card_added" ) );
    } ) );
    actions.appendChild( Ui.button( Ui.t( "scanners.copy_markdown" ) , "markdown" , async () => {
      try {
        await navigator.clipboard.writeText( this.markdown( card ) );
        Dom.toast( Ui.t( "ui.copied" ) , "ok" );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    } ) );
    actions.appendChild( Ui.button( Ui.t( "ui.delete" ) , "trash" , async () => {
      if ( this.cards.length <= 1 ) {
        Dom.toast( Ui.t( "scanners.last_card" ) , "error" );
        return;
      }
      if ( usedBy.length ) Dom.toast( Ui.t( "scanners.delete_used" ) + " " + usedBy.join( ", " ) , "ok" );
      try {
        await this.remove( card.id );
        Undo.record( {
          label: Ui.t( "undo.card_deleted" ) , toast: true,
          undo: () => this.restore( card.id ),
          redo: () => this.remove( card.id ),
        } );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    } , { variant: "btn-outline-danger" } ) );
    box.appendChild( Ui.section( Ui.t( "scanners.section_pages" ) , this.pages( card ) ) );
    box.appendChild( actions );
    return box;
  },

  // The console pages as tabs, and the selected page's rows.
  pages( card ) {
    const wrap = Dom.el( "div" );
    if ( this.page >= card.pages.length ) this.page = Math.max( 0 , card.pages.length - 1 );
    const tabs = Dom.el( "ul" , { class: "nav nav-tabs card-pages" , attrs: { role: "tablist" } } );
    card.pages.forEach( ( page , index ) => {
      const link = Dom.el( "button" , { class: "nav-link" + ( index === this.page ? " active" : "" ) , text: page.name + " (" + page.rows.length + ")" , attrs: { type: "button" , role: "tab" } } );
      link.addEventListener( "click" , () => {
        this.page = index;
        Designer.repaint( this.name );
      } );
      tabs.appendChild( Dom.el( "li" , { class: "nav-item" , children: [ link ] } ) );
    } );
    const addPage = Dom.el( "button" , { class: "nav-link" , attrs: { type: "button" , title: Ui.t( "scanners.add_page" ) , "aria-label": Ui.t( "scanners.add_page" ) } , children: [ Dom.el( "i" , { class: "bi bi-plus-lg" } ) ] } );
    addPage.addEventListener( "click" , () => {
      this.edit( Ui.t( "undo.card_changed" ) , ( c ) => c.pages.push( { name: Ui.t( "scanners.new_page" ) + " " + ( c.pages.length + 1 ) , rows: [] } ) );
      this.page = card.pages.length;
      Designer.repaint( this.name );
    } );
    tabs.appendChild( Dom.el( "li" , { class: "nav-item" , children: [ addPage ] } ) );
    wrap.appendChild( tabs );

    const page = card.pages[ this.page ];
    if ( !page ) {
      wrap.appendChild( Ui.empty( Ui.t( "scanners.no_pages" ) ) );
      return wrap;
    }
    const index = this.page;
    const editPage = ( label , fn , options ) => this.edit( label , ( c ) => { if ( c.pages[ index ] ) fn( c.pages[ index ] , c ); } , options );

    const search = Ui.text( this.filter , () => {} , { key: "card.filter" , placeholder: Ui.t( "scanners.filter" ) } );
    search.addEventListener( "input" , () => {
      this.filter = search.value;
      Designer.repaint( this.name );
    } );
    const pageName = Ui.text( page.name , ( v ) => editPage( Ui.t( "undo.card_changed" ) , ( p ) => { p.name = v.trim() || p.name; } ) , { key: "card.page" , maxlength: 80 } );
    const deletePage = Ui.button( Ui.t( "scanners.delete_page" ) , "trash" , () => {
      this.edit( Ui.t( "undo.card_changed" ) , ( c ) => c.pages.splice( index , 1 ) , { toast: true } );
    } , { variant: "btn-outline-danger" } );
    wrap.appendChild( Ui.row( [
      Ui.field( "scanners.page_name" , pageName , { col: "col-md-4" } ),
      Ui.field( "scanners.filter_label" , search , { col: "col-md-4" } ),
      Ui.bare( deletePage , "col-md-auto ms-md-auto" ),
    ] , "mt-3" ) );

    const needle = this.filter.trim().toLowerCase();
    const list = Dom.el( "div" , { class: "param-list mt-2" } );
    page.rows.forEach( ( row , r ) => {
      if ( needle && !( row.parameter + " " + row.value ).toLowerCase().includes( needle ) ) return;
      const key = "card.r" + index + "." + r;
      const editRow = ( label , fn , options ) => editPage( label , ( p ) => { if ( p.rows[ r ] ) fn( p.rows[ r ] , p ); } , options );
      const name = Ui.text( row.parameter , ( v ) => editRow( Ui.t( "undo.card_changed" ) , ( x ) => { x.parameter = v; } ) , { key: key + ".p" , maxlength: 200 } );
      name.setAttribute( "aria-label" , Ui.t( "scanners.parameter" ) );
      const yesNo = /^(yes|no)$/i.test( String( row.value ) );
      const value = yesNo
        ? Ui.select( String( row.value ).toLowerCase() , [ [ "yes" , "yes" ] , [ "no" , "no" ] ] , ( v ) => editRow( Ui.t( "undo.card_changed" ) , ( x ) => { x.value = v; } ) , { key: key + ".v" } )
        : Ui.text( row.value , ( v ) => editRow( Ui.t( "undo.card_changed" ) , ( x ) => { x.value = v; } ) , { key: key + ".v" , maxlength: 500 } );
      value.setAttribute( "aria-label" , Ui.t( "scanners.value" ) );
      const tools = Dom.el( "div" , { class: "row-actions flex-nowrap" , children: [
        Ui.icon( "text-indent-right" , Ui.t( "scanners.outdent" ) , () => editRow( Ui.t( "undo.card_changed" ) , ( x ) => { x.indent = Math.max( 0 , x.indent - 1 ); } ) , { disabled: row.indent === 0 } ),
        Ui.icon( "text-indent-left" , Ui.t( "scanners.indent" ) , () => editRow( Ui.t( "undo.card_changed" ) , ( x ) => { x.indent = Math.min( 4 , x.indent + 1 ); } ) , { disabled: row.indent >= 4 } ),
        Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => editPage( Ui.t( "undo.card_changed" ) , ( p ) => Ui.move( p.rows , r , -1 ) ) , { disabled: r === 0 } ),
        Ui.icon( "arrow-down" , Ui.t( "ui.move_down" ) , () => editPage( Ui.t( "undo.card_changed" ) , ( p ) => Ui.move( p.rows , r , 1 ) ) , { disabled: r === page.rows.length - 1 } ),
        Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => editPage( Ui.t( "undo.card_changed" ) , ( p ) => p.rows.splice( r , 1 ) ) , { variant: "btn-outline-danger" } ),
      ] } );
      const item = Dom.el( "div" , { class: "param-row" , children: [
        Dom.el( "div" , { class: "param-name" , children: [ name ] } ), value, tools,
      ] } );
      item.style.setProperty( "--indent" , String( row.indent ) );
      list.appendChild( item );
    } );
    if ( !list.children.length ) list.appendChild( Ui.empty( needle ? Ui.t( "scanners.no_match" ) : Ui.t( "scanners.no_rows" ) ) );
    wrap.appendChild( list );
    wrap.appendChild( Ui.button( Ui.t( "scanners.add_row" ) , "plus" , () => {
      editPage( Ui.t( "undo.card_changed" ) , ( p ) => p.rows.push( { parameter: "" , value: "" , indent: 0 } ) );
    } , { small: true , class: "mt-2" } ) );
    return wrap;
  },
};
