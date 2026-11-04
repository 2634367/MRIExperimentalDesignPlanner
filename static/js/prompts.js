// The Prompts screen: prompt lists, their columns, and their items.
//
// A list is a table, like a PsychoPy conditions file. Its columns are yours
// to define -- text, a picture, a number -- and a trial type draws one item
// per trial, filling "{column}" in its layers from that item. So whatever
// varies between trials of one kind (the word, the picture, the answer, a
// category to balance on, a cue) is a column here, not a separate concept
// kept somewhere else.
//
// A column's key is what {key} templates are written with. Renaming the key
// rewrites every template and balance setting that uses it, so nothing is
// left pointing at the old name.
const Prompts = {
  name: "prompts",
  selected: null,
  filter: "",
  showAll: false,
  PAGE: 200,

  current() {
    const lists = Doc.doc.lists;
    if ( !lists.some( ( l ) => l.id === this.selected ) ) this.selected = lists.length ? lists[ 0 ].id : null;
    return lists.find( ( l ) => l.id === this.selected ) || null;
  },

  focus( id ) {
    this.selected = id;
  },

  edit( label , fn , options ) {
    const id = this.selected;
    Doc.change( label , ( d ) => {
      const list = d.lists.find( ( l ) => l.id === id );
      if ( list ) fn( list , d );
    } , options );
  },

  render( root ) {
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "lists.description" ) ) );
    const lists = Doc.doc.lists;
    const list = this.current();

    const bar = Dom.el( "div" , { class: "d-flex flex-wrap gap-2 align-items-center mb-3" } );
    const pills = Dom.el( "ul" , { class: "nav nav-pills flex-wrap gap-1" } );
    lists.forEach( ( l ) => {
      const link = Dom.el( "button" , { class: "nav-link" + ( l.id === this.selected ? " active" : "" ) , attrs: { type: "button" } , text: ( l.name || Ui.t( "lists.unnamed" ) ) + " (" + l.items.length + ")" } );
      link.addEventListener( "click" , () => {
        this.selected = l.id;
        this.filter = "";
        Designer.refresh();
      } );
      pills.appendChild( Dom.el( "li" , { class: "nav-item" , children: [ link ] } ) );
    } );
    bar.appendChild( pills );
    bar.appendChild( Ui.button( Ui.t( "lists.new" ) , "plus-lg" , () => {
      const fresh = Schema.list( Doc.nextName( "lists" , "lists.default_name" ) );
      Doc.change( Ui.t( "undo.list_added" ) , ( d ) => d.lists.push( fresh ) );
      this.selected = fresh.id;
      Designer.refresh();
    } , { variant: "btn-outline-primary" , editOnly: true } ) );
    root.appendChild( bar );

    if ( !list ) {
      root.appendChild( Ui.empty( Ui.t( "lists.none" ) ) );
      return;
    }
    root.appendChild( Ui.section( Ui.t( "lists.section_list" ) , this.listHeader( list ) ) );
    root.appendChild( this.columnsEditor( list ) );
    root.appendChild( this.itemsTable( list ) );
  },

  listHeader( list ) {
    const usedBy = Validate.usages( Doc.doc , "list" , list.id );
    const fields = Ui.row( [
      Ui.field( "lists.name" , Ui.text( list.name , ( v ) => this.edit( Ui.t( "undo.list_renamed" ) , ( l ) => { l.name = v.trim(); } ) , { key: "list.name" } ) , { col: "col-md-4" } ),
      Ui.field( "lists.notes" , Ui.text( list.notes , ( v ) => this.edit( Ui.t( "undo.list_changed" ) , ( l ) => { l.notes = v; } ) , { key: "list.notes" } ) , { col: "col-md" } ),
    ] );
    const actions = Dom.el( "div" , { class: "row-actions mt-2" , children: [
      Ui.button( Ui.t( "lists.import" ) , "upload" , () => this.importDialog( list ) , { editOnly: true } ),
      Ui.button( Ui.t( "lists.export" ) , "download" , () => this.exportCsv( list ) ),
      Ui.button( Ui.t( "ui.duplicate" ) , "files" , () => {
        const copy = JSON.parse( JSON.stringify( list ) );
        copy.id = Schema.uid( "list" );
        copy.name = ( list.name || Ui.t( "lists.unnamed" ) ) + " " + Ui.t( "ui.copy_suffix" );
        copy.items.forEach( ( item ) => { item.id = Schema.uid( "i" ); } );
        Doc.change( Ui.t( "undo.list_added" ) , ( d ) => d.lists.push( copy ) );
        this.selected = copy.id;
        Designer.refresh();
      } , { editOnly: true } ),
      Ui.button( Ui.t( "ui.delete" ) , "trash" , () => {
        if ( usedBy.length ) {
          Dom.toast( Ui.t( "lists.still_used" ) + " " + usedBy.join( ", " ) , "error" );
          return;
        }
        Doc.change( Ui.t( "undo.list_deleted" ) , ( d ) => { d.lists = d.lists.filter( ( l ) => l.id !== list.id ); } , { toast: true } );
      } , { variant: "btn-outline-danger" , editOnly: true } ),
    ] } );
    const note = usedBy.length ? Ui.muted( Ui.t( "lists.used_by" ) + " " + usedBy.join( ", " ) , "mt-2" ) : Ui.muted( Ui.t( "lists.unused" ) , "mt-2" );
    return Dom.el( "div" , { children: [ fields , actions , note ] } );
  },

  // -- columns ----------------------------------------------------------------

  columnsEditor( list ) {
    // A section card that folds away: the summary is its title strip.
    const fold = Dom.el( "details" , { class: "card ed-section mb-3 columns-editor" } );
    fold.open = list.items.length === 0 || this.columnsOpen === true;
    fold.addEventListener( "toggle" , () => { this.columnsOpen = fold.open; } );
    fold.appendChild( Dom.el( "summary" , { class: "card-header ed-section-head" , children: [ Dom.el( "h3" , { class: "h6 mb-0" , text: Ui.t( "lists.columns" ) + " (" + list.columns.length + ")" } ) ] } ) );
    const box = Dom.el( "div" , { class: "card-body" } );
    fold.appendChild( box );
    box.appendChild( Ui.muted( Ui.t( "lists.columns_help" ) ) );
    const table = Dom.el( "table" , { class: "table table-sm align-middle" } );
    table.appendChild( Dom.el( "thead" , { children: [ Dom.el( "tr" , { children: [
      Dom.el( "th" , { text: Ui.t( "lists.column_label" ) } ),
      Dom.el( "th" , { text: Ui.t( "lists.column_key" ) } ),
      Dom.el( "th" , { text: Ui.t( "lists.column_type" ) } ),
      Dom.el( "th" , { text: "" } ),
    ] } ) ] } ) );
    const body = Dom.el( "tbody" );
    list.columns.forEach( ( column , index ) => {
      const setColumn = ( label , fn ) => this.edit( label , ( l , d ) => {
        const c = l.columns.find( ( x ) => x.key === column.key );
        if ( c ) fn( c , l , d );
      } );
      const actions = Dom.el( "div" , { class: "row-actions" } );
      if ( !Doc.readOnly ) {
        actions.appendChild( Ui.icon( "arrow-up" , Ui.t( "ui.move_up" ) , () => setColumn( Ui.t( "undo.column_moved" ) , ( c , l ) => Ui.move( l.columns , l.columns.indexOf( c ) , -1 ) ) , { disabled: index === 0 } ) );
        actions.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => setColumn( Ui.t( "undo.column_deleted" ) , ( c , l ) => {
          l.columns.splice( l.columns.indexOf( c ) , 1 );
          l.items.forEach( ( item ) => { delete item.values[ c.key ]; } );
        } ) , { variant: "btn-outline-danger" } ) );
      }
      body.appendChild( Dom.el( "tr" , { children: [
        Dom.el( "td" , { children: [ Ui.text( column.label , ( v ) => setColumn( Ui.t( "undo.column_renamed" ) , ( c ) => { c.label = v.trim() || c.label; } ) , { key: "col.label." + column.key , small: true } ) ] } ),
        Dom.el( "td" , { children: [ Ui.text( column.key , ( v ) => this.renameKey( list , column.key , v ) , { key: "col.key." + column.key , small: true } ) ] } ),
        Dom.el( "td" , { children: [ Ui.select( column.type , Schema.COLUMN_TYPES.map( ( t ) => [ t , Ui.t( "lists.type_" + t ) ] ) , ( v ) => setColumn( Ui.t( "undo.column_changed" ) , ( c ) => { c.type = v; } ) , { small: true , key: "col.type." + column.key } ) ] } ),
        Dom.el( "td" , { children: [ actions ] } ),
      ] } ) );
    } );
    table.appendChild( body );
    box.appendChild( Dom.el( "div" , { class: "table-responsive" , children: [ table ] } ) );
    box.appendChild( Ui.button( Ui.t( "lists.add_column" ) , "plus-lg" , () => this.edit( Ui.t( "undo.column_added" ) , ( l ) => {
      const column = Schema.column( Ui.t( "lists.new_column" ) , "text" , l.columns.map( ( c ) => c.key ) );
      l.columns.push( column );
      l.items.forEach( ( item ) => { item.values[ column.key ] = ""; } );
    } ) , { small: true , editOnly: true } ) );
    return fold;
  },

  // Rename a column key and every {key}, balance_by and filter that uses it.
  renameKey( list , oldKey , wanted ) {
    const key = Schema.columnKey( wanted , list.columns.map( ( c ) => c.key ).filter( ( k ) => k !== oldKey ) );
    if ( key === oldKey ) {
      Designer.refresh();
      return;
    }
    this.edit( Ui.t( "undo.column_renamed" ) , ( l , d ) => {
      const column = l.columns.find( ( c ) => c.key === oldKey );
      if ( !column ) return;
      column.key = key;
      l.items.forEach( ( item ) => {
        item.values[ key ] = item.values[ oldKey ];
        delete item.values[ oldKey ];
      } );
      const swap = ( text ) => String( text ).split( "{" + oldKey + "}" ).join( "{" + key + "}" );
      d.trial_types.filter( ( tt ) => tt.list === l.id ).forEach( ( tt ) => {
        if ( tt.balance_by === oldKey ) tt.balance_by = key;
        if ( tt.filter.column === oldKey ) tt.filter.column = key;
        tt.phases.forEach( ( phase ) => phase.layers.forEach( ( layer ) => {
          if ( layer.kind === "text" ) layer.text = swap( layer.text );
          if ( layer.kind === "image" ) layer.media = swap( layer.media );
        } ) );
      } );
    } );
    Dom.toast( Ui.t( "lists.key_renamed" ).replace( "{key}" , key ) , "ok" );
  },

  // -- items ------------------------------------------------------------------

  itemsTable( list ) {
    const search = Dom.el( "input" , { class: "form-control form-control-sm search-box" , attrs: { type: "search" , placeholder: Ui.t( "lists.search" ) , "data-key": "items.search" } } );
    search.value = this.filter;
    search.addEventListener( "input" , () => {
      this.filter = search.value;
      Ui.keep( Dom.get( "screen-prompts" ) , () => this.render( Dom.get( "screen-prompts" ) ) );
    } );
    const section = Ui.section( Ui.t( "lists.items" ) + " (" + list.items.length + ")" , [] , { actions: [
      search , Ui.button( Ui.t( "lists.add_item" ) , "plus-lg" , () => this.addItem( list ) , { small: true , variant: "btn-primary" , editOnly: true } ),
    ] } );
    const wrap = section.querySelector( ".card-body" );

    if ( !list.columns.length ) {
      wrap.appendChild( Ui.empty( Ui.t( "lists.no_columns" ) ) );
      return section;
    }
    const needle = this.filter.trim().toLowerCase();
    const mediaNames = Object.fromEntries( Doc.doc.media.map( ( m ) => [ m.id , m.name ] ) );
    let rows = list.items.map( ( item , index ) => ( { item: item , index: index } ) );
    if ( needle ) rows = rows.filter( ( r ) => Object.values( r.item.values ).some( ( v ) => String( mediaNames[ v ] || v ).toLowerCase().includes( needle ) ) );
    const total = rows.length;
    if ( !this.showAll && rows.length > this.PAGE ) rows = rows.slice( 0 , this.PAGE );

    const table = Dom.el( "table" , { class: "table table-sm table-hover align-middle items-table" } );
    const headRow = Dom.el( "tr" , { children: [ Dom.el( "th" , { class: "text-body-secondary" , text: "#" } ) ] } );
    list.columns.forEach( ( c ) => headRow.appendChild( Dom.el( "th" , { children: [
      Dom.el( "span" , { text: c.label || c.key } ), Dom.el( "code" , { class: "ms-1 small" , text: "{" + c.key + "}" } ),
    ] } ) ) );
    headRow.appendChild( Dom.el( "th" , { text: "" } ) );
    table.appendChild( Dom.el( "thead" , { children: [ headRow ] } ) );
    const body = Dom.el( "tbody" );
    rows.forEach( ( { item , index } ) => body.appendChild( this.itemRow( list , item , index ) ) );
    table.appendChild( body );
    wrap.appendChild( Dom.el( "div" , { class: "table-responsive" , children: [ table ] } ) );
    if ( !list.items.length ) wrap.appendChild( Ui.empty( Ui.t( "lists.no_items" ) ) );
    if ( total > rows.length ) {
      wrap.appendChild( Ui.button( Ui.t( "lists.show_all" ).replace( "{count}" , total ) , "chevron-down" , () => {
        this.showAll = true;
        Designer.refresh();
      } , { small: true } ) );
    }
    return section;
  },

  itemRow( list , item , index ) {
    const setValue = ( key ) => ( value ) => this.edit( Ui.t( "undo.item_changed" ) , ( l ) => {
      const target = l.items.find( ( i ) => i.id === item.id );
      if ( target ) target.values[ key ] = value;
    } );
    const row = Dom.el( "tr" , { children: [ Dom.el( "td" , { class: "text-body-secondary small" , text: String( index + 1 ) } ) ] } );
    list.columns.forEach( ( c ) => {
      const key = "item." + item.id + "." + c.key;
      const value = item.values[ c.key ] || "";
      let cell;
      if ( c.type === "image" ) {
        cell = this.imageCell( value , setValue( c.key ) , key );
      } else if ( c.type === "number" ) {
        cell = Ui.input( "number" , value , ( v , input ) => setValue( c.key )( input.value ) , { key: key , small: true , step: "any" } );
      } else {
        cell = Ui.text( value , setValue( c.key ) , { key: key , small: true } );
      }
      row.appendChild( Dom.el( "td" , { class: c.type === "image" ? "image-cell" : "" , children: [ cell ] } ) );
    } );
    const actions = Dom.el( "div" , { class: "row-actions" } );
    actions.appendChild( Ui.icon( "eye" , Ui.t( "lists.preview_item" ) , () => this.previewItem( list , item ) ) );
    if ( !Doc.readOnly ) {
      actions.appendChild( Ui.icon( "files" , Ui.t( "ui.duplicate" ) , () => this.edit( Ui.t( "undo.item_added" ) , ( l ) => {
        const at = l.items.findIndex( ( i ) => i.id === item.id );
        l.items.splice( at + 1 , 0 , Schema.item( l.items[ at ].values ) );
      } ) ) );
      actions.appendChild( Ui.icon( "trash" , Ui.t( "ui.delete" ) , () => this.edit( Ui.t( "undo.item_deleted" ) , ( l ) => {
        l.items = l.items.filter( ( i ) => i.id !== item.id );
      } , { toast: true } ) , { variant: "btn-outline-danger" } ) );
    }
    row.appendChild( Dom.el( "td" , { children: [ actions ] } ) );
    return row;
  },

  imageCell( value , commit , key ) {
    const entry = Doc.doc.media.find( ( m ) => m.id === value ) || null;
    const cell = Dom.el( "div" , { class: "d-flex align-items-center gap-1" } );
    if ( entry ) {
      cell.appendChild( MediaLibrary.thumb( entry , { class: "thumb-sm" } ) );
      cell.appendChild( Dom.el( "span" , { class: "small text-truncate image-name" , text: entry.name } ) );
    } else if ( value ) {
      cell.appendChild( Dom.badge( Ui.t( "lists.picture_missing" ) , "danger" ) );
    }
    if ( !Doc.readOnly ) {
      const choose = Ui.icon( "image" , Ui.t( "layers.choose_picture" ) , async () => {
        const sha = await MediaLibrary.pick();
        if ( sha ) commit( sha );
      } );
      choose.setAttribute( "data-key" , key );
      cell.appendChild( choose );
      if ( value ) cell.appendChild( Ui.icon( "x-lg" , Ui.t( "ui.clear" ) , () => commit( "" ) ) );
      MediaLibrary.dropTarget( cell , ( ids ) => commit( ids[ ids.length - 1 ] ) );
    }
    return cell;
  },

  addItem( list ) {
    const fresh = Schema.item( Object.fromEntries( list.columns.map( ( c ) => [ c.key , "" ] ) ) );
    this.edit( Ui.t( "undo.item_added" ) , ( l ) => l.items.push( fresh ) );
    this.filter = "";
    window.setTimeout( () => {
      const first = list.columns.find( ( c ) => c.type !== "image" );
      const input = first && document.querySelector( '[data-key="item.' + fresh.id + "." + first.key + '"]' );
      if ( input ) input.focus();
    } , 50 );
  },

  // Every phase of one trial with this item, through a trial type that uses
  // this list -- and a way to play it.
  previewItem( list , item ) {
    const doc = Doc.doc;
    const users = doc.trial_types.filter( ( tt ) => tt.list === list.id );
    const types = users.length ? users : doc.trial_types;
    if ( !types.length ) {
      Dom.toast( Ui.t( "lists.preview_no_trial" ) , "error" );
      return;
    }
    let typeId = types[ 0 ].id;
    const strip = Dom.el( "div" , { class: "phase-strip-preview" } );
    const paint = () => {
      const tt = doc.trial_types.find( ( x ) => x.id === typeId );
      strip.replaceChildren( ...tt.phases.map( ( phase ) => {
        const box = Display.screen( doc.display.aspect );
        Display.preview( box , doc , phase.layers , item , list , ( sha ) => Doc.mediaUrl( sha ) );
        return Dom.el( "figure" , { class: "phase-thumb" , children: [ box , Dom.el( "figcaption" , { class: "small" , text: ( phase.name || "" ) + " · " + Timing.describe( Timing.span( phase.duration , doc.scanner.tr ) ) } ) ] } );
      } ) );
    };
    const picker = Ui.select( typeId , types.map( ( tt ) => [ tt.id , tt.name || Ui.t( "trials.unnamed" ) ] ) , ( v ) => {
      typeId = v;
      paint();
    } );
    paint();
    const body = Dom.el( "div" , { children: [ Ui.row( [ Ui.field( "lists.preview_through" , picker , { col: "col-md-6" } ) ] ) , Dom.el( "div" , { class: "mt-3" , children: [ strip ] } ) ] } );
    Ui.dialog( {
      title: Ui.t( "lists.preview_title" ) , body: body , size: "modal-xl",
      buttons: [
        { text: Ui.t( "run.play_trial" ) , icon: "play-fill" , variant: "btn-primary" , run: () => {
          RunDialog.open( { title: Compile.itemLabel( item , list ) , kind: "trial" , build: ( o ) => Compile.trialPlans( Doc.doc , { id: Doc.id } , typeId , item.id , o ) } );
        } },
        { text: Ui.t( "ui.close" ) },
      ],
    } );
  },

  // -- import / export ----------------------------------------------------------

  exportCsv( list ) {
    const names = Object.fromEntries( Doc.doc.media.map( ( m ) => [ m.id , m.name ] ) );
    const rows = [ list.columns.map( ( c ) => c.label || c.key ) ];
    list.items.forEach( ( item ) => rows.push( list.columns.map( ( c ) => ( c.type === "image" ? names[ item.values[ c.key ] ] || "" : item.values[ c.key ] ) ) ) );
    Ui.download( ( list.name || "prompts" ).replace( /[^A-Za-z0-9_-]+/g , "-" ) + ".csv" , new Blob( [ Ui.toCsv( rows ) ] , { type: "text/csv" } ) );
  },

  importDialog( list ) {
    const area = Dom.el( "textarea" , { class: "form-control font-monospace" , attrs: { rows: "10" , placeholder: Ui.t( "lists.import_placeholder" ) } } );
    const file = Dom.el( "input" , { class: "form-control" , attrs: { type: "file" , accept: ".csv,.tsv,.txt,text/csv,text/plain" } } );
    file.addEventListener( "change" , async () => {
      if ( file.files[ 0 ] ) area.value = await file.files[ 0 ].text();
    } );
    let mode = "append";
    const modeSelect = Ui.select( mode , [ [ "append" , Ui.t( "lists.import_append" ) ] , [ "replace" , Ui.t( "lists.import_replace" ) ] ] , ( v ) => { mode = v; } );
    const body = Dom.el( "div" , { children: [
      Ui.muted( Ui.t( "lists.import_help" ) ),
      Ui.row( [ Ui.field( "lists.import_file" , file , { col: "col-md" } ) , Ui.field( "lists.import_mode" , modeSelect , { col: "col-md-4" } ) ] ),
      Dom.el( "div" , { class: "mt-2" , children: [ area ] } ),
    ] } );
    Ui.dialog( {
      title: Ui.t( "lists.import_title" ) , body: body , size: "modal-lg",
      buttons: [
        { text: Ui.t( "ui.cancel" ) },
        { text: Ui.t( "lists.import_button" ) , variant: "btn-primary" , run: async () => {
          const rows = Ui.parseTable( area.value );
          if ( rows.length < 2 ) {
            Dom.toast( Ui.t( "lists.import_nothing" ) , "error" );
            return false;
          }
          await this.importRows( list , rows , mode );
          return true;
        } },
      ],
    } );
  },

  // First row is headers, matched to columns by label or key; new headers
  // become new columns. In a picture column a URL is fetched (the server
  // keeps a copy) and a name matches a picture already in the library.
  async importRows( list , rows , mode ) {
    const headers = rows[ 0 ].map( ( h ) => h.trim() );
    const data = rows.slice( 1 );
    const keys = list.columns.map( ( c ) => c.key );
    const plan = headers.map( ( header ) => {
      const lower = header.toLowerCase();
      const existing = list.columns.find( ( c ) => c.label.toLowerCase() === lower || c.key === lower );
      if ( existing ) return { key: existing.key , type: existing.type , fresh: null };
      const looksImage = data.some( ( r ) => /^https?:\/\/\S+\.(png|jpe?g|gif|webp)(\?|$)/i.test( ( r[ headers.indexOf( header ) ] || "" ).trim() ) );
      const column = Schema.column( header || Ui.t( "lists.new_column" ) , looksImage ? "image" : "text" , keys );
      keys.push( column.key );
      return { key: column.key , type: column.type , fresh: column };
    } );

    // Pictures first: fetch URLs once each, match names to the library.
    const byName = Object.fromEntries( Doc.doc.media.map( ( m ) => [ m.name.toLowerCase() , m.id ] ) );
    const fetched = {};
    const urls = new Set();
    plan.forEach( ( p , col ) => {
      if ( p.type !== "image" ) return;
      data.forEach( ( r ) => {
        const v = ( r[ col ] || "" ).trim();
        if ( /^https?:\/\//i.test( v ) ) urls.add( v );
      } );
    } );
    let done = 0;
    for ( const url of urls ) {
      Dom.toast( Ui.t( "lists.import_fetching" ).replace( "{done}" , done ).replace( "{total}" , urls.size ) , "ok" );
      fetched[ url ] = await MediaLibrary.fromUrl( url );
      done += 1;
    }
    const resolve = ( p , raw ) => {
      const v = ( raw || "" ).trim();
      if ( p.type !== "image" ) return v;
      if ( fetched[ v ] ) return fetched[ v ];
      if ( /^[0-9a-f]{64}$/.test( v ) ) return v;
      return byName[ v.replace( /\.[^.]+$/ , "" ).toLowerCase() ] || byName[ v.toLowerCase() ] || "";
    };
    const items = data.map( ( r ) => {
      const values = {};
      plan.forEach( ( p , col ) => { values[ p.key ] = resolve( p , r[ col ] ); } );
      return values;
    } );
    this.edit( Ui.t( "undo.items_imported" ) , ( l ) => {
      plan.filter( ( p ) => p.fresh ).forEach( ( p ) => l.columns.push( p.fresh ) );
      if ( mode === "replace" ) l.items = [];
      items.forEach( ( values ) => l.items.push( Schema.item( values ) ) );
    } , { toast: true } );
    Dom.toast( Ui.t( "lists.imported" ).replace( "{count}" , items.length ) , "ok" );
  },
};
