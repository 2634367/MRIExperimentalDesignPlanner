// Form pieces the design screens are built from. Each control commits on
// "change" (Enter, Tab, picking an option) rather than on every keystroke,
// so one edit is one undo step, and every one is disabled on a read-only
// (shared) document.
//
// Screens repaint from the document after every change. Ui.keep() puts the
// focus back on the control with the same data-key afterwards, so tabbing
// through a form does not lose your place.
const Ui = {
  t( key ) {
    return I18n.get( key );
  },

  // Repaint root with render(), keeping focus and caret where they were.
  keep( root , render ) {
    const active = document.activeElement;
    const key = active && root.contains( active ) ? active.getAttribute( "data-key" ) : null;
    let caret = null;
    try {
      caret = key && typeof active.selectionStart === "number" ? [ active.selectionStart , active.selectionEnd ] : null;
    } catch ( error ) {
      caret = null;
    }
    const scroll = window.scrollY;
    render();
    if ( key ) {
      const again = root.querySelector( '[data-key="' + CSS.escape( key ) + '"]' );
      if ( again ) {
        again.focus( { preventScroll: true } );
        if ( caret && typeof again.setSelectionRange === "function" ) {
          try { again.setSelectionRange( caret[ 0 ] , caret[ 1 ] ); } catch ( error ) { /* not a text input */ }
        }
      }
    }
    window.scrollTo( 0 , scroll );
  },

  readOnly() {
    return Doc.readOnly;
  },

  // label + control, as a Bootstrap grid column.
  field( labelKey , control , options ) {
    const settings = options || {};
    const id = control.id || ( control.id = "f_" + Math.random().toString( 36 ).slice( 2 , 10 ) );
    const label = Dom.el( "label" , { class: "form-label small mb-1" , text: settings.label || this.t( labelKey ) , attrs: { for: id } } );
    const children = [ label , control ];
    if ( settings.help ) children.push( Dom.el( "div" , { class: "form-text" , text: settings.help } ) );
    return Dom.el( "div" , { class: settings.col || "col-md" , children: children } );
  },

  // A control with no label of its own (a button beside some fields), pushed
  // down by an invisible label so it lines up with their inputs.
  bare( control , col ) {
    const spacer = Dom.el( "div" , { class: "form-label small mb-1 label-spacer" , text: " " , attrs: { "aria-hidden": "true" } } );
    return Dom.el( "div" , { class: col || "col-md-auto" , children: [ spacer , control ] } );
  },

  // Fields in a row line up at the top -- labels on one line, inputs on the
  // next -- so help text under one input never shifts its neighbours.
  row( children , extra ) {
    return Dom.el( "div" , { class: "row g-2 align-items-start " + ( extra || "" ) , children: children.filter( Boolean ) } );
  },

  input( type , value , onCommit , options ) {
    const settings = options || {};
    const input = Dom.el( "input" , { class: "form-control" + ( settings.small ? " form-control-sm" : "" ) , attrs: { type: type } } );
    input.value = value == null ? "" : String( value );
    if ( settings.key ) input.setAttribute( "data-key" , settings.key );
    if ( settings.placeholder ) input.placeholder = settings.placeholder;
    [ "min" , "max" , "step" , "maxlength" ].forEach( ( a ) => { if ( settings[ a ] != null ) input.setAttribute( a , settings[ a ] ); } );
    input.disabled = this.readOnly() || Boolean( settings.disabled );
    input.addEventListener( "change" , () => onCommit( type === "number" ? Number( input.value ) : input.value , input ) );
    return input;
  },

  text( value , onCommit , options ) {
    return this.input( "text" , value , onCommit , Object.assign( { maxlength: 2000 } , options ) );
  },

  number( value , onCommit , options ) {
    const settings = Object.assign( { step: "any" } , options );
    return this.input( "number" , value , ( v , input ) => {
      if ( !Number.isFinite( v ) ) return;
      onCommit( v , input );
    } , settings );
  },

  textarea( value , onCommit , options ) {
    const settings = options || {};
    const area = Dom.el( "textarea" , { class: "form-control" , attrs: { rows: String( settings.rows || 3 ) } } );
    area.value = value || "";
    if ( settings.key ) area.setAttribute( "data-key" , settings.key );
    if ( settings.placeholder ) area.placeholder = settings.placeholder;
    area.disabled = this.readOnly();
    area.addEventListener( "change" , () => onCommit( area.value ) );
    return area;
  },

  // options: [[value, label], ...]
  select( value , options , onCommit , settings ) {
    const extra = settings || {};
    const select = Dom.el( "select" , { class: "form-select" + ( extra.small ? " form-select-sm" : "" ) } );
    options.forEach( ( option ) => {
      const node = Dom.el( "option" , { text: option[ 1 ] } );
      node.value = option[ 0 ];
      select.appendChild( node );
    } );
    select.value = value == null ? "" : String( value );
    if ( extra.key ) select.setAttribute( "data-key" , extra.key );
    select.disabled = this.readOnly() || Boolean( extra.disabled );
    select.addEventListener( "change" , () => onCommit( select.value ) );
    return select;
  },

  check( value , labelText , onCommit , options ) {
    const settings = options || {};
    const input = Dom.el( "input" , { class: "form-check-input" , attrs: { type: "checkbox" } } );
    input.id = "c_" + Math.random().toString( 36 ).slice( 2 , 10 );
    input.checked = Boolean( value );
    if ( settings.key ) input.setAttribute( "data-key" , settings.key );
    input.disabled = this.readOnly();
    input.addEventListener( "change" , () => onCommit( input.checked ) );
    return Dom.el( "div" , { class: "form-check " + ( settings.class || "" ) , children: [ input , Dom.el( "label" , { class: "form-check-label" , text: labelText , attrs: { for: input.id } } ) ] } );
  },

  // A colour, or "" for "the display's text colour" when allowEmpty.
  color( value , onCommit , options ) {
    const settings = options || {};
    const wrap = Dom.el( "div" , { class: "input-group" + ( settings.small ? " input-group-sm" : "" ) } );
    // Without the hex text the swatch stretches to fill the column.
    const picker = Dom.el( "input" , { class: "form-control form-control-color" + ( settings.hex ? "" : " flex-grow-1" ) , attrs: { type: "color" , title: this.t( "ui.color" ) } } );
    picker.value = value || settings.fallback || "#ffffff";
    picker.disabled = this.readOnly();
    if ( settings.key ) picker.setAttribute( "data-key" , settings.key );
    picker.addEventListener( "change" , () => onCommit( picker.value ) );
    wrap.appendChild( picker );
    // hex: the value as text beside the swatch, so the field fills its
    // column like the inputs next to it and a colour can be typed or pasted.
    if ( settings.hex ) {
      const text = Dom.el( "input" , { class: "form-control font-monospace" , attrs: { type: "text" , maxlength: "7" , spellcheck: "false" , "aria-label" : this.t( "ui.color" ) } } );
      text.value = picker.value;
      text.disabled = this.readOnly();
      if ( settings.key ) text.setAttribute( "data-key" , settings.key + ".hex" );
      text.addEventListener( "change" , () => {
        const value = text.value.trim().replace( /^#?/ , "#" ).toLowerCase();
        if ( /^#[0-9a-f]{6}$/.test( value ) ) onCommit( value );
        else text.value = picker.value;
      } );
      wrap.appendChild( text );
    }
    if ( settings.allowEmpty ) {
      const auto = Dom.el( "button" , {
        class: "btn btn-outline-secondary" + ( value ? "" : " active" ) , text: this.t( "ui.color_auto" ) ,
        attrs: { type: "button" , title: this.t( "ui.color_auto_help" ) } ,
        on: { click: () => onCommit( "" ) },
      } );
      auto.disabled = this.readOnly();
      wrap.appendChild( auto );
    }
    return wrap;
  },

  button( text , icon , onClick , options ) {
    const settings = options || {};
    const button = Dom.el( "button" , { class: "btn " + ( settings.variant || "btn-outline-secondary" ) + ( settings.small ? " btn-sm" : "" ) + " " + ( settings.class || "" ) , attrs: { type: "button" } } );
    if ( icon ) button.appendChild( Dom.el( "i" , { class: "bi bi-" + icon , attrs: { "aria-hidden": "true" } } ) );
    if ( text ) button.appendChild( Dom.el( "span" , { class: icon ? "ms-1" : "" , text: text } ) );
    if ( settings.title ) button.title = settings.title;
    if ( settings.editOnly && this.readOnly() ) button.hidden = true;
    if ( settings.disabled ) button.disabled = true;
    button.addEventListener( "click" , onClick );
    return button;
  },

  icon( icon , title , onClick , options ) {
    const settings = Object.assign( { small: true , title: title } , options );
    const button = this.button( "" , icon , onClick , settings );
    button.setAttribute( "aria-label" , title );
    return button;
  },

  heading( text , level , extra ) {
    return Dom.el( "h" + ( level || 3 ) , { class: "h6 mt-3 mb-2 " + ( extra || "" ) , text: text } );
  },

  // One part of an editor (Instructions, Lead-in, Blocks…) on its own card,
  // titled in a strip across the top, so the parts do not run together.
  // options: actions (buttons right of the title), help (a line under it),
  // extra (classes on the card).
  // fold: a key that makes the card fold shut on its title strip, starting
  // shut until it is opened (see Ui.folding).
  section( title , children , options ) {
    const settings = options || {};
    const head = Dom.el( "div" , { class: "card-header ed-section-head" } );
    const heading = Dom.el( "h3" , { class: "h6 mb-0 me-auto" } );
    head.appendChild( heading );
    ( settings.actions || [] ).forEach( ( a ) => { if ( a ) head.appendChild( a ); } );
    const body = Dom.el( "div" , { class: "card-body" } );
    if ( settings.help ) body.appendChild( this.muted( settings.help ) );
    [].concat( children ).forEach( ( c ) => { if ( c ) body.appendChild( c ); } );
    if ( settings.fold ) heading.appendChild( this.folding( settings.fold , title , [ body ] , head ) );
    else heading.textContent = title;
    return Dom.el( "section" , { class: "card ed-section mb-3 " + ( settings.extra || "" ) , children: [ head , body ] } );
  },

  // Cards that fold (editor sections, phases, blocks) start shut so a screen
  // is a list of titles; the ones opened are remembered in this browser, by
  // key, across repaints and visits.
  openKey: "open-cards",
  opened: null,
  isOpen( key ) {
    if ( !this.opened ) {
      try {
        this.opened = new Set( JSON.parse( window.localStorage.getItem( this.openKey ) || "[]" ) );
      } catch ( error ) {
        this.opened = new Set();
      }
    }
    return this.opened.has( key );
  },

  setOpen( key , open ) {
    this.isOpen( key );
    if ( open ) this.opened.add( key );
    else this.opened.delete( key );
    try { window.localStorage.setItem( this.openKey , JSON.stringify( Array.from( this.opened ) ) ); } catch ( error ) { /* not remembered */ }
  },

  // The button that folds parts (hidden while shut) away, with a chevron
  // and, if given, the title as its text. A click on the bare strip (strip,
  // if given) folds too; its own buttons and fields keep their clicks.
  folding( key , title , parts , strip ) {
    const button = Dom.el( "button" , { class: "fold-toggle" , attrs: { type: "button" } } );
    button.appendChild( Dom.el( "i" , { class: "bi bi-chevron-right" , attrs: { "aria-hidden": "true" } } ) );
    if ( title ) button.appendChild( Dom.el( "span" , { text: title } ) );
    else button.setAttribute( "aria-label" , this.t( "ui.fold" ) );
    const show = ( open ) => {
      button.setAttribute( "aria-expanded" , String( open ) );
      parts.forEach( ( p ) => { p.hidden = !open; } );
    };
    show( this.isOpen( key ) );
    button.addEventListener( "click" , () => {
      const open = button.getAttribute( "aria-expanded" ) !== "true";
      this.setOpen( key , open );
      show( open );
    } );
    if ( strip ) {
      strip.classList.add( "fold-strip" );
      strip.addEventListener( "click" , ( event ) => {
        if ( !event.target.closest( "button, input, select, textarea, a, label" ) ) button.click();
      } );
    }
    return button;
  },

  muted( text , extra ) {
    return Dom.el( "p" , { class: "text-body-secondary small mb-2 " + ( extra || "" ) , text: text } );
  },

  empty( text ) {
    return Dom.el( "div" , { class: "empty-state" , text: text } );
  },

  // The list on the left of an editor: pick one, add one.
  picker( items , selectedId , onPick , options ) {
    const settings = options || {};
    if ( settings.chips ) return this.chips( items , selectedId , onPick , settings );
    if ( settings.dropdown ) return this.dropdown( items , selectedId , onPick , settings );
    const group = Dom.el( "div" , { class: "list-group picker-list" } );
    items.forEach( ( item ) => {
      const button = Dom.el( "button" , {
        class: "list-group-item list-group-item-action d-flex align-items-center gap-2" + ( item.id === selectedId ? " active" : "" ),
        attrs: { type: "button" },
        on: { click: () => onPick( item.id ) },
      } );
      if ( item.color ) {
        const swatch = Dom.el( "span" , { class: "swatch" } );
        swatch.style.background = item.color;
        button.appendChild( swatch );
      }
      // stacked: the name wraps, with the meta on a line of its own under it,
      // for long names (scanner cards) that a single line would cut off.
      if ( settings.stacked ) {
        button.appendChild( Dom.el( "span" , { class: "flex-grow-1 picker-stacked" , children: [
          Dom.el( "span" , { class: "d-block" , text: item.name || settings.unnamed || "" } ),
          item.meta ? Dom.el( "small" , { class: "d-block picker-meta" , text: item.meta } ) : null,
        ].filter( Boolean ) } ) );
      } else {
        button.appendChild( Dom.el( "span" , { class: "flex-grow-1 text-truncate" , text: item.name || settings.unnamed || "" } ) );
        if ( item.meta ) button.appendChild( Dom.el( "small" , { class: "picker-meta" , text: item.meta } ) );
      }
      group.appendChild( button );
    } );
    return group;
  },

  // The picker as one wrapping row of compact chips above a full-width
  // editor, for screens whose editor needs the room (runs, sessions).
  // settings.add, if given, is a button put at the end of the row.
  chips( items , selectedId , onPick , settings ) {
    const row = Dom.el( "div" , { class: "picker-chips" , attrs: { role: "group" } } );
    items.forEach( ( item ) => {
      const active = item.id === selectedId;
      const button = Dom.el( "button" , {
        class: "picker-chip" + ( active ? " active" : "" ),
        attrs: { type: "button" , "aria-pressed": String( active ) },
        on: { click: () => onPick( item.id ) },
      } );
      button.appendChild( Dom.el( "span" , { class: "text-truncate" , text: item.name || settings.unnamed || "" } ) );
      if ( item.meta ) button.appendChild( Dom.el( "small" , { class: "picker-meta" , text: item.meta } ) );
      row.appendChild( button );
    } );
    if ( settings.add ) row.appendChild( settings.add );
    return row;
  },

  // The picker as one dropdown above a full-width editor, for screens with
  // many things to pick from (trial types). The chosen one's colour shows
  // beside it; picking stays possible when the document is read-only.
  // settings.add, if given, is a button (or several) put after the dropdown.
  dropdown( items , selectedId , onPick , settings ) {
    const bar = Dom.el( "div" , { class: "picker-dropdown" } );
    const current = items.find( ( item ) => item.id === selectedId );
    if ( current && current.color ) {
      const swatch = Dom.el( "span" , { class: "swatch" } );
      swatch.style.background = current.color;
      bar.appendChild( swatch );
    }
    if ( items.length ) {
      const select = Dom.el( "select" , { class: "form-select" , attrs: { "aria-label": settings.label || "" } } );
      items.forEach( ( item ) => {
        const name = item.name || settings.unnamed || "";
        const node = Dom.el( "option" , { text: item.meta ? name + "  ·  " + item.meta : name } );
        node.value = item.id;
        select.appendChild( node );
      } );
      select.value = selectedId == null ? "" : String( selectedId );
      select.addEventListener( "change" , () => onPick( select.value ) );
      bar.appendChild( select );
      bar.appendChild( Dom.el( "small" , { class: "picker-meta text-nowrap" , text: ( items.findIndex( ( item ) => item.id === selectedId ) + 1 ) + " / " + items.length } ) );
    }
    [].concat( settings.add || [] ).forEach( ( a ) => bar.appendChild( a ) );
    return bar;
  },

  // Move an element of an array by delta, for up/down buttons.
  move( array , index , delta ) {
    const target = index + delta;
    if ( target < 0 || target >= array.length ) return;
    const [ item ] = array.splice( index , 1 );
    array.splice( target , 0 , item );
  },

  // A download of something made in the browser.
  download( filename , blob ) {
    const url = URL.createObjectURL( blob );
    const link = Dom.el( "a" , { attrs: { href: url , download: filename } } );
    document.body.appendChild( link );
    link.click();
    link.remove();
    window.setTimeout( () => URL.revokeObjectURL( url ) , 10000 );
  },

  // A Bootstrap modal built on the fly: { title, body (node), buttons }.
  // Resolves with whatever the clicked button's value is (null on close).
  dialog( options ) {
    return new Promise( ( resolve ) => {
      const footer = Dom.el( "div" , { class: "modal-footer" } );
      let result = null;
      const modalNode = Dom.el( "div" , { class: "modal fade" , attrs: { tabindex: "-1" } , children: [
        Dom.el( "div" , { class: "modal-dialog modal-dialog-scrollable " + ( options.size || "" ) , children: [
          Dom.el( "div" , { class: "modal-content" , children: [
            Dom.el( "div" , { class: "modal-header" , children: [
              Dom.el( "h2" , { class: "modal-title h5" , text: options.title } ),
              Dom.el( "button" , { class: "btn-close" , attrs: { type: "button" , "data-bs-dismiss": "modal" , "aria-label": this.t( "nav.close" ) } } ),
            ] } ),
            Dom.el( "div" , { class: "modal-body" , children: [ options.body ] } ),
            footer,
          ] } ),
        ] } ),
      ] } );
      const instance = new bootstrap.Modal( modalNode );
      ( options.buttons || [] ).forEach( ( spec ) => {
        footer.appendChild( this.button( spec.text , spec.icon , async () => {
          if ( spec.run ) {
            const keepOpen = await spec.run();
            if ( keepOpen === false ) return;
          }
          result = spec.value === undefined ? true : spec.value;
          instance.hide();
        } , { variant: spec.variant || "btn-outline-secondary" } ) );
      } );
      modalNode.addEventListener( "hidden.bs.modal" , () => {
        modalNode.remove();
        resolve( result );
      } );
      document.body.appendChild( modalNode );
      instance.show();
      if ( options.onShow ) options.onShow( modalNode );
    } );
  },

  // Parse CSV or tab-separated text (pasted from a spreadsheet) into rows.
  parseTable( text ) {
    const source = String( text || "" ).replace( /\r\n?/g , "\n" );
    const firstLine = source.split( "\n" )[ 0 ] || "";
    const sep = firstLine.includes( "\t" ) ? "\t" : firstLine.includes( ";" ) && !firstLine.includes( "," ) ? ";" : ",";
    const rows = [];
    let row = [];
    let cell = "";
    let quoted = false;
    for ( let i = 0; i < source.length; i += 1 ) {
      const c = source[ i ];
      if ( quoted ) {
        if ( c === '"' && source[ i + 1 ] === '"' ) { cell += '"'; i += 1; }
        else if ( c === '"' ) quoted = false;
        else cell += c;
      } else if ( c === '"' && cell === "" ) quoted = true;
      else if ( c === sep ) { row.push( cell ); cell = ""; }
      else if ( c === "\n" ) { row.push( cell ); rows.push( row ); row = []; cell = ""; }
      else cell += c;
    }
    if ( cell !== "" || row.length ) { row.push( cell ); rows.push( row ); }
    return rows.filter( ( r ) => r.some( ( v ) => v.trim() !== "" ) );
  },

  toCsv( rows ) {
    return rows.map( ( row ) => row.map( ( value ) => {
      const s = String( value == null ? "" : value );
      return /[",\n]/.test( s ) ? '"' + s.replace( /"/g , '""' ) + '"' : s;
    } ).join( "," ) ).join( "\n" ) + "\n";
  },
};
