// Pictures: the experiment's image library, and the picker every picture
// field opens.
//
// A picture is uploaded from a file (or dropped), or fetched by the server
// from a URL -- either way the server keeps its own copy, named by its
// content, and the experiment lists it in doc.media. Prompt items and layers
// refer to it by that id, so renaming a picture here renames it everywhere.
const MediaLibrary = {
  name: "pictures",

  // Store files on the server and add them to the document. Resolves with
  // the new media ids, in order.
  async upload( files ) {
    const ids = [];
    for ( const file of Array.from( files ) ) {
      try {
        const row = await Api.uploadMedia( Doc.id , file );
        this.remember( row , file.name.replace( /\.[^.]+$/ , "" ) );
        ids.push( row.id );
      } catch ( error ) {
        Dom.toast( file.name + ": " + error.message , "error" );
      }
    }
    if ( ids.length ) Dom.toast( Ui.t( "media.added" ).replace( "{count}" , ids.length ) , "ok" );
    return ids;
  },

  async fromUrl( url ) {
    try {
      const row = await Api.mediaFromUrl( Doc.id , url.trim() );
      const name = decodeURIComponent( ( new URL( row.source_url ).pathname.split( "/" ).pop() || "" ).replace( /\.[^.]+$/ , "" ) ) || row.id.slice( 0 , 10 );
      this.remember( row , name );
      Dom.toast( Ui.t( "media.fetched" ) , "ok" );
      return row.id;
    } catch ( error ) {
      Dom.toast( error.message , "error" );
      return null;
    }
  },

  remember( row , name ) {
    if ( Doc.doc.media.some( ( m ) => m.id === row.id ) ) return;
    Doc.change( Ui.t( "undo.picture_added" ) , ( d ) => {
      d.media.push( { id: row.id , name: ( name || "" ).slice( 0 , 120 ) , ext: row.ext , mime: row.mime , w: row.w , h: row.h , size: row.size , source_url: row.source_url || "" } );
    } );
  },

  // Upload + URL controls, used by the screen and the picker dialog.
  addControls( onAdded ) {
    const file = Dom.el( "input" , { class: "form-control" , attrs: { type: "file" , accept: "image/png,image/jpeg,image/gif,image/webp" , multiple: "multiple" } } );
    file.addEventListener( "change" , async () => {
      const ids = await this.upload( file.files );
      file.value = "";
      if ( onAdded ) onAdded( ids );
    } );
    const url = Dom.el( "input" , { class: "form-control" , attrs: { type: "url" , placeholder: "https://…" } } );
    const fetchButton = Ui.button( Ui.t( "media.fetch_button" ) , "cloud-download" , async () => {
      if ( !url.value.trim() ) return;
      fetchButton.disabled = true;
      const id = await this.fromUrl( url.value );
      fetchButton.disabled = false;
      if ( id ) {
        url.value = "";
        if ( onAdded ) onAdded( [ id ] );
      }
    } , { variant: "btn-outline-primary" } );
    const drop = Dom.el( "div" , { class: "drop-zone" , text: Ui.t( "media.drop_here" ) } );
    this.dropTarget( drop , onAdded );
    return Dom.el( "div" , { children: [
      Ui.row( [
        Ui.field( "media.upload_label" , file , { col: "col-md-5" } ),
        Ui.field( "media.url_label" , url , { col: "col-md" } ),
        Ui.bare( fetchButton ),
      ] ),
      Dom.el( "div" , { class: "form-text" , text: Ui.t( "media.url_help" ) } ),
      drop,
    ] } );
  },

  // Any element files (or a picture dragged from another web page) can be
  // dropped on.
  dropTarget( node , onAdded ) {
    node.addEventListener( "dragover" , ( event ) => {
      event.preventDefault();
      node.classList.add( "drop-over" );
    } );
    node.addEventListener( "dragleave" , () => node.classList.remove( "drop-over" ) );
    node.addEventListener( "drop" , async ( event ) => {
      event.preventDefault();
      node.classList.remove( "drop-over" );
      if ( Doc.readOnly ) return;
      let ids = [];
      if ( event.dataTransfer.files && event.dataTransfer.files.length ) {
        ids = await this.upload( event.dataTransfer.files );
      } else {
        const link = event.dataTransfer.getData( "text/uri-list" ) || event.dataTransfer.getData( "text/plain" );
        if ( /^https?:\/\//.test( link || "" ) ) {
          const id = await this.fromUrl( link.split( "\n" )[ 0 ] );
          if ( id ) ids = [ id ];
        }
      }
      if ( onAdded && ids.length ) onAdded( ids );
    } );
  },

  thumb( entry , options ) {
    const settings = options || {};
    const img = Dom.el( "img" , { class: settings.class || "thumb" , attrs: { alt: entry ? entry.name : "" , loading: "lazy" } } );
    if ( entry ) img.src = Doc.mediaUrl( entry.id );
    return img;
  },

  // A dialog to choose one picture. Resolves with its id, or null.
  pick() {
    let chosen = null;
    const grid = Dom.el( "div" , { class: "media-grid media-grid-pick" } );
    const paint = () => {
      grid.replaceChildren();
      if ( !Doc.doc.media.length ) grid.appendChild( Ui.empty( Ui.t( "media.empty" ) ) );
      Doc.doc.media.forEach( ( entry ) => {
        const tile = Dom.el( "button" , { class: "media-tile" , attrs: { type: "button" , title: entry.name , "data-id": entry.id } , children: [
          this.thumb( entry ) , Dom.el( "span" , { class: "media-name" , text: entry.name } ),
        ] } );
        tile.addEventListener( "click" , () => {
          chosen = entry.id;
          Dom.all( ".media-tile" , grid ).forEach( ( t ) => t.classList.remove( "selected" ) );
          tile.classList.add( "selected" );
        } );
        tile.addEventListener( "dblclick" , () => {
          chosen = entry.id;
          const ok = document.querySelector( ".modal.show .btn-primary" );
          if ( ok ) ok.click();
        } );
        grid.appendChild( tile );
      } );
    };
    paint();
    const body = Dom.el( "div" , { children: [
      this.addControls( ( ids ) => {
        paint();
        if ( ids.length ) {
          chosen = ids[ ids.length - 1 ];
          const tile = Dom.all( ".media-tile" , grid ).find( ( t ) => t.getAttribute( "data-id" ) === chosen );
          if ( tile ) tile.classList.add( "selected" );
        }
      } ),
      Dom.el( "hr" ),
      grid,
    ] } );
    return Ui.dialog( {
      title: Ui.t( "media.pick_title" ) , body: body , size: "modal-lg",
      buttons: [
        { text: Ui.t( "ui.cancel" ) , value: null },
        { text: Ui.t( "media.pick_button" ) , variant: "btn-primary" , run: () => ( chosen ? true : false ) , value: "ok" },
      ],
    } ).then( ( result ) => ( result === "ok" ? chosen : null ) );
  },

  // -- the Pictures screen --------------------------------------------------

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "media.description" ) ) );
    if ( !Doc.readOnly ) root.appendChild( this.addControls() );
    const grid = Dom.el( "div" , { class: "media-grid mt-3" } );
    if ( !doc.media.length ) grid.appendChild( Ui.empty( Ui.t( "media.empty" ) ) );
    doc.media.forEach( ( entry ) => {
      const used = Validate.usages( doc , "media" , entry.id );
      const name = Ui.text( entry.name , ( value ) => Doc.change( Ui.t( "undo.picture_renamed" ) , ( d ) => {
        const target = d.media.find( ( m ) => m.id === entry.id );
        if ( target ) target.name = value.trim() || target.name;
      } ) , { key: "media." + entry.id , small: true } );
      const meta = entry.w + "×" + entry.h + " · " + ( entry.size / 1024 ).toFixed( 0 ) + " KB";
      const tile = Dom.el( "div" , { class: "media-card" , children: [
        this.thumb( entry ),
        name,
        Dom.el( "div" , { class: "small text-body-secondary" , text: meta } ),
        Dom.el( "div" , { class: "small" , text: used.length ? Ui.t( "media.used_in" ) + " " + used.join( ", " ) : Ui.t( "media.unused" ) } ),
      ] } );
      if ( !Doc.readOnly ) {
        tile.appendChild( Ui.button( Ui.t( "ui.remove" ) , "trash" , () => {
          if ( used.length ) {
            Dom.toast( Ui.t( "media.still_used" ) + " " + used.join( ", " ) , "error" );
            return;
          }
          Doc.change( Ui.t( "undo.picture_removed" ) , ( d ) => { d.media = d.media.filter( ( m ) => m.id !== entry.id ); } , { toast: true } );
        } , { small: true , variant: "btn-outline-danger" } ) );
      }
      grid.appendChild( tile );
    } );
    root.appendChild( grid );
  },
};
