// The Experiments screen: every experiment you own or edit, making a new
// one (blank or from the example), importing one (this app's JSON, or the
// old planner's design and question bank files), and -- for the one that is
// open -- who else can edit it and its read-only share links.
const Experiments = {
  name: "experiments",
  rows: [],
  team: [],
  links: [],
  freshLink: null,

  async load() {
    try {
      this.rows = await Api.listExperiments();
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  async open( id , screen ) {
    await Doc.flush();
    const row = await Api.getExperiment( id );
    Undo.clear();
    Doc.open( row );
    this.freshLink = null;
    this.links = [];
    if ( screen ) Nav.show( screen );
  },

  async create( doc , screen ) {
    const row = await Api.createExperiment( doc );
    await this.load();
    await this.open( row.id , screen || "overview" );
    return row;
  },

  render( root ) {
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "experiments.description" ) ) );
    root.appendChild( Ui.section( Ui.t( "experiments.section_new" ) , this.newForm() ) );
    root.appendChild( Ui.section( Ui.t( "experiments.section_list" ) , this.table() ) );
    if ( Doc.isOpen() ) root.appendChild( this.currentCard() );
  },

  newForm() {
    let start = "example";
    const name = Ui.text( "" , () => {} , { placeholder: Ui.t( "experiments.name_placeholder" ) } );
    name.disabled = false;
    const from = Ui.select( start , [ [ "example" , Ui.t( "experiments.from_example" ) ] , [ "blank" , Ui.t( "experiments.from_blank" ) ] ] , ( v ) => { start = v; } );
    from.disabled = false;
    const create = Ui.button( Ui.t( "experiments.create" ) , "plus-lg" , async () => {
      const title = name.value.trim() || Ui.t( start === "example" ? "example.name" : "experiments.untitled" );
      const doc = start === "example" ? Schema.example( title ) : Schema.blank( title );
      if ( start === "blank" ) {
        doc.trial_types.push( Schema.trialType( Ui.t( "trials.default_name" ) ) );
      }
      try {
        await this.create( doc );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    } , { variant: "btn-primary" } );
    const file = Dom.el( "input" , { class: "form-control" , attrs: { type: "file" , accept: ".json,application/json" } } );
    file.addEventListener( "change" , async () => {
      const chosen = file.files[ 0 ];
      file.value = "";
      if ( chosen ) await this.importFile( chosen );
    } );
    const form = Dom.el( "div" , { children: [
      Ui.row( [
        Ui.field( "experiments.name" , name , { col: "col-md-5" } ),
        Ui.field( "experiments.start_from" , from , { col: "col-md-3" } ),
        Ui.bare( create ),
      ] ),
      Ui.row( [ Ui.field( "experiments.import" , file , { col: "col-md-8" , help: Ui.t( "experiments.import_help" ) } ) ] , "mt-2" ),
    ] } );
    return form;
  },

  table() {
    const table = Dom.el( "table" , { class: "table table-hover align-middle" } );
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: [
      Dom.el( "th" , { text: Ui.t( "experiments.table_name" ) } ),
      Dom.el( "th" , { text: Ui.t( "experiments.table_owner" ) } ),
      Dom.el( "th" , { text: Ui.t( "experiments.table_updated" ) } ),
      Dom.el( "th" , { text: "" } ),
    ] } ) ] } ) );
    const body = Dom.el( "tbody" );
    this.rows.forEach( ( row ) => {
      const isOpen = Doc.id === row.id;
      const name = Dom.el( "a" , { text: row.name || Ui.t( "experiments.untitled" ) , attrs: { href: "#overview" } } );
      name.addEventListener( "click" , async ( event ) => {
        event.preventDefault();
        await this.open( row.id , "overview" );
      } );
      const actions = Dom.el( "div" , { class: "row-actions" } );
      actions.appendChild( Ui.button( isOpen ? Ui.t( "experiments.is_open" ) : Ui.t( "experiments.open" ) , "box-arrow-in-right" , () => this.open( row.id , "overview" ) , { small: true , disabled: isOpen } ) );
      actions.appendChild( Ui.icon( "files" , Ui.t( "ui.duplicate" ) , async () => {
        try {
          await Doc.flush();
          const copy = await Api.duplicateExperiment( row.id , ( row.name || "" ) + " " + Ui.t( "ui.copy_suffix" ) );
          await this.load();
          await this.open( copy.id , "overview" );
        } catch ( error ) {
          Dom.toast( error.message , "error" );
        }
      } ) );
      if ( row.is_owner ) actions.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => this.remove( row ) , { variant: "btn-outline-danger" } ) );
      body.appendChild( Dom.el( "tr" , { class: isOpen ? "table-active" : "" , children: [
        Dom.el( "td" , { children: [ name ] } ),
        Dom.el( "td" , { class: "small" , text: row.is_owner ? Ui.t( "experiments.you" ) : row.owner_name } ),
        Dom.el( "td" , { class: "small text-body-secondary" , text: new Date( row.updated_at ).toLocaleString() + ( row.updated_by_name ? " · " + row.updated_by_name : "" ) } ),
        Dom.el( "td" , { children: [ actions ] } ),
      ] } ) );
    } );
    table.appendChild( body );
    const wrap = Dom.el( "div" , { class: "table-responsive mb-0" , children: [ table ] } );
    table.classList.add( "mb-0" );
    if ( !this.rows.length ) wrap.appendChild( Ui.empty( Ui.t( "experiments.none" ) ) );
    return wrap;
  },

  async remove( row ) {
    try {
      await Doc.flush();
      await Api.deleteExperiment( row.id );
      if ( Doc.id === row.id ) Doc.close();
      await this.load();
      Designer.refresh();
      Undo.record( {
        label: Ui.t( "undo.experiment_deleted" ) , toast: true , screen: "experiments",
        undo: async () => {
          await Api.restoreExperiment( row.id );
          await this.load();
          Designer.refresh();
        },
        redo: async () => {
          await Api.deleteExperiment( row.id );
          if ( Doc.id === row.id ) Doc.close();
          await this.load();
          Designer.refresh();
        },
      } );
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  // -- the open experiment: export, editors, share links -------------------

  currentCard() {
    // Three cards: export, who may edit, share links. card is the body of
    // whichever is being filled.
    const wrap = Dom.el( "div" );
    const part = ( title ) => {
      const section = Ui.section( title , [] );
      wrap.appendChild( section );
      return section.querySelector( ".card-body" );
    };
    let card = part( Ui.t( "experiments.current" ) + " · " + ( Doc.doc.name || "" ) );
    card.appendChild( Dom.el( "div" , { class: "row-actions mb-2" , children: [
      Ui.button( Ui.t( "experiments.export" ) , "download" , () => {
        const blob = new Blob( [ JSON.stringify( Doc.doc , null , 1 ) ] , { type: "application/json" } );
        Ui.download( ( Doc.doc.name || "experiment" ).replace( /[^A-Za-z0-9_-]+/g , "-" ) + ".json" , blob );
      } ),
    ] } ) );
    card.appendChild( Ui.muted( Ui.t( "experiments.export_help" ) , "mb-0" ) );

    const isOwner = Doc.row && Doc.row.is_owner;
    card = part( Ui.t( "experiments.editors" ) );
    if ( isOwner ) {
      card.appendChild( Ui.muted( Ui.t( "experiments.editors_help" ) ) );
      const box = Dom.el( "div" , { class: "d-flex flex-wrap gap-3" } );
      const editors = new Set( ( Doc.row.editors || [] ).map( ( e ) => e.id ) );
      const others = this.team.filter( ( member ) => member.id !== Doc.row.owner );
      if ( !others.length ) box.appendChild( Ui.muted( Ui.t( "experiments.no_team" ) ) );
      others.forEach( ( member ) => {
        const check = Ui.check( editors.has( member.id ) , member.display_name , async ( on ) => {
          const next = new Set( editors );
          if ( on ) next.add( member.id ); else next.delete( member.id );
          try {
            const row = await Api.setEditors( Doc.id , Array.from( next ) );
            Doc.row.editors = row.editors;
            Dom.toast( Ui.t( "experiments.editors_saved" ) , "ok" );
          } catch ( error ) {
            Dom.toast( error.message , "error" );
          }
          Designer.refresh();
        } );
        box.appendChild( check );
      } );
      card.appendChild( box );
    } else {
      card.appendChild( Ui.muted( Ui.t( "experiments.owned_by" ).replace( "{name}" , Doc.row ? Doc.row.owner_name : "" ) ) );
    }

    card = part( Ui.t( "experiments.share_links" ) );
    card.appendChild( Ui.muted( Ui.t( "experiments.share_help" ) ) );
    const label = Ui.text( "" , () => {} , { placeholder: Ui.t( "experiments.share_label_placeholder" ) } );
    card.appendChild( Ui.row( [
      Ui.field( "experiments.share_label" , label , { col: "col-md-6" } ),
      Ui.bare( Ui.button( Ui.t( "experiments.share_create" ) , "link-45deg" , async () => {
        try {
          const row = await Api.createShareLink( Doc.id , label.value.trim() );
          this.freshLink = window.location.origin + row.path;
          await this.loadLinks();
        } catch ( error ) {
          Dom.toast( error.message , "error" );
        }
      } , { variant: "btn-outline-primary" } ) ),
    ] ) );
    if ( this.freshLink ) {
      const code = Dom.el( "code" , { text: this.freshLink } );
      card.appendChild( Dom.el( "div" , { class: "alert alert-info mt-3" , children: [
        Dom.el( "p" , { class: "mb-2" , text: Ui.t( "experiments.share_once" ) } ),
        Dom.el( "div" , { class: "link-box" , children: [ code , Ui.button( Ui.t( "ui.copy" ) , "clipboard" , () => Dom.copy( code ) , { small: true } ) ] } ),
      ] } ) );
    }
    const live = this.links.filter( ( l ) => !l.revoked );
    if ( live.length ) {
      const table = Dom.el( "table" , { class: "table table-sm align-middle mt-3" } );
      const body = Dom.el( "tbody" );
      live.forEach( ( link ) => body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { text: link.label || Ui.t( "experiments.share_unlabelled" ) } ),
        Dom.el( "td" , { class: "small text-body-secondary" , text: new Date( link.created_at ).toLocaleDateString() } ),
        Dom.el( "td" , { children: [ Ui.button( Ui.t( "experiments.share_revoke" ) , "x-octagon" , async () => {
          if ( !window.confirm( Ui.t( "experiments.share_revoke_confirm" ) ) ) return;
          try {
            await Api.revokeShareLink( Doc.id , link.id );
            await this.loadLinks();
          } catch ( error ) {
            Dom.toast( error.message , "error" );
          }
        } , { small: true , variant: "btn-outline-danger" } ) ] } ),
      ] } ) ) );
      table.appendChild( body );
      card.appendChild( table );
    }
    return wrap;
  },

  async loadLinks() {
    if ( !Doc.isOpen() || Doc.readOnly ) return;
    try {
      this.links = await Api.listShareLinks( Doc.id );
    } catch ( error ) {
      this.links = [];
    }
    Designer.refresh();
  },

  // -- importing ------------------------------------------------------------

  async importFile( file ) {
    let data;
    try {
      data = JSON.parse( await file.text() );
    } catch ( error ) {
      Dom.toast( Ui.t( "experiments.import_not_json" ) , "error" );
      return;
    }
    try {
      if ( Legacy.isBank( data ) ) {
        if ( !Doc.isOpen() ) {
          Dom.toast( Ui.t( "experiments.import_bank_needs_open" ) , "error" );
          return;
        }
        const report = await Legacy.importBank( data , file.name.replace( /\.json$/i , "" ) );
        Nav.show( "prompts" );
        Dom.toast( report , "ok" );
        return;
      }
      if ( Legacy.isOldDesign( data ) ) {
        if ( !Scanners.loaded ) await Scanners.load();
        const converted = Legacy.convertDesign( data , Scanners.cards );
        await this.create( converted.doc );
        this.report( converted.notes );
        return;
      }
      if ( data && typeof data === "object" && data.format_version ) {
        const doc = Schema.normalise( data );
        const pictures = doc.media.length;
        if ( pictures ) doc.media = [];
        await this.create( doc );
        if ( pictures ) Dom.toast( Ui.t( "experiments.import_pictures_dropped" ).replace( "{count}" , pictures ) , "error" );
        return;
      }
      Dom.toast( Ui.t( "experiments.import_unknown" ) , "error" );
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    }
  },

  report( notes ) {
    if ( !notes.length ) return;
    const list = Dom.el( "ul" , { class: "small" } );
    notes.forEach( ( note ) => list.appendChild( Dom.el( "li" , { text: note } ) ) );
    Ui.dialog( { title: Ui.t( "legacy.report_title" ) , body: Dom.el( "div" , { children: [ Ui.muted( Ui.t( "legacy.report_intro" ) ) , list ] } ) , buttons: [ { text: Ui.t( "ui.close" ) , variant: "btn-primary" } ] } );
  },
};
