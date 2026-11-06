// The Report screen: a methods paragraph, every table, every figure, and a
// zip of all of it (report.xlsx, report.md, methods.txt, the tables as
// Markdown, the figures as SVG and PNG, and the experiment JSON). The
// browser draws the tables and figures -- the same code as the screens --
// and the server only packages them (app/routes/report.py).
const Report = {
  name: "report",
  seed: 1,
  methodsDraft: null,
  tableId: "",
  shuffling: false,
  lockedPick: "",
  PUBLISH_PART_BYTES: 8 * 1024 * 1024,

  render( root ) {
    const doc = Doc.doc;
    root.replaceChildren();
    root.appendChild( Ui.muted( Ui.t( "report.description" ) ) );
    const card = ( title , children ) => Ui.section( title , children );

    // Downloads.
    const status = Dom.el( "span" , { class: "small text-body-secondary" } );
    const seed = Ui.number( this.seed , ( v ) => { this.seed = Math.max( 0 , Math.round( v ) ); Designer.repaint( this.name ); } , { key: "report.seed" , min: 0 , step: 1 , small: true } );
    seed.disabled = false;
    seed.classList.add( "report-seed" );
    root.appendChild( card( Ui.t( "report.download" ) , [
      Ui.muted( Ui.t( "report.download_help" ) ),
      Dom.el( "div" , { class: "row-actions align-items-center" , children: [
        Ui.button( Ui.t( "report.zip" ) , "file-earmark-zip" , () => this.download( false , status ) , { variant: "btn-primary" } ),
        Ui.button( Ui.t( "report.xlsx" ) , "file-earmark-spreadsheet" , () => this.download( true , status ) ),
        Ui.button( Ui.t( "report.markdown" ) , "markdown" , () => Ui.download( Charts.slug( doc.name ) + ".md" , new Blob( [ this.markdown( doc ) ] , { type: "text/markdown" } ) ) ),
        Dom.el( "label" , { class: "small text-body-secondary ms-2" , text: Ui.t( "report.seed" ) , attrs: { for: seed.id || "" } } ),
        seed,
        status,
      ] } ),
    ] ) );

    root.appendChild( this.lockedCard() );
    if ( !Doc.shareCredential ) root.appendChild( this.publishCard() );

    // Methods.
    const area = Dom.el( "textarea" , { class: "form-control" , attrs: { rows: "10" , "data-key": "report.methods" } } );
    area.value = this.methodsDraft == null ? this.methods( doc ) : this.methodsDraft;
    area.addEventListener( "input" , () => { this.methodsDraft = area.value; } );
    root.appendChild( card( Ui.t( "report.methods" ) , [
      Ui.muted( Ui.t( "report.methods_help" ) ),
      area,
      Dom.el( "div" , { class: "row-actions mt-2" , children: [
        Ui.button( Ui.t( "report.copy_methods" ) , "clipboard" , () => Tables.write( area.value , null ) , { small: true } ),
        Ui.button( Ui.t( "report.regenerate" ) , "arrow-clockwise" , () => { this.methodsDraft = null; area.value = this.methods( doc ); } , { small: true } ),
      ] } ),
    ] ) );

    // Tables.
    const tables = Tables.all( doc , this.seed );
    if ( !tables.some( ( t ) => t.id === this.tableId ) ) this.tableId = tables[ 0 ].id;
    const picker = Ui.select( this.tableId , tables.map( ( t ) => [ t.id , t.title ] ) , ( v ) => { this.tableId = v; Designer.repaint( this.name ); } , { key: "report.table" } );
    picker.disabled = false;
    root.appendChild( card( Ui.t( "report.tables" ) , [
      Dom.el( "div" , { class: "row-actions mb-2 align-items-center" , children: [
        Dom.el( "div" , { class: "report-picker" , children: [ picker ] } ),
        Ui.button( Ui.t( "report.copy_all_markdown" ) , "markdown" , () => Tables.copyMarkdown( tables ) , { small: true } ),
        Ui.button( Ui.t( "report.copy_all_word" ) , "file-earmark-word" , () => Tables.copyWord( tables ) , { small: true } ),
      ] } ),
      Tables.view( tables.find( ( t ) => t.id === this.tableId ) ),
    ] ) );

    // Figures.
    const gallery = Dom.el( "div" , { class: "figure-gallery" } );
    this.figures( doc ).forEach( ( f ) => gallery.appendChild( Dom.el( "div" , { class: "figure-item" , children: [ Charts.figure( f.make , f.name ) ] } ) ) );
    root.appendChild( card( Ui.t( "report.figures" ) , [ gallery ] ) );
  },

  // The design figures, plus the HRF and each run's efficiency trace.
  figures( doc ) {
    const out = Figures.all( doc );
    out.push( { name: "hrf" , make: ( light ) => HrfView.plot( doc.hrf ).svg( light ) } );
    if ( Efficiency.regressors( doc ).length ) {
      doc.runs.forEach( ( run ) => {
        const result = Efficiency.run( doc , run , this.seed );
        if ( !result.regressors.length ) return;
        out.push( { name: "efficiency-" + ( run.name || run.id ) , make: ( light ) => Charts.linePlot( Runs.efficiencySpec( result , run ) ).svg( light ) } );
      } );
    }
    return out;
  },

  markdown( doc ) {
    const tables = Tables.all( doc , this.seed );
    return "# " + doc.name + "\n\n## " + Ui.t( "report.methods" ) + "\n\n" + ( this.methodsDraft || this.methods( doc ) ) + "\n\n"
      + tables.map( ( t ) => "## " + t.title + "\n\n" + Tables.markdown( t ) ).join( "\n" );
  },

  async download( xlsxOnly , status ) {
    const doc = Doc.doc;
    status.textContent = Ui.t( "report.building" );
    try {
      const figures = xlsxOnly ? [] : await this.drawnFigures( doc );
      const body = {
        tables: Tables.all( doc , this.seed ),
        methods: this.methodsDraft || this.methods( doc ),
        figures: figures,
        only: xlsxOnly ? "xlsx" : "",
      };
      const file = Doc.shareCredential ? await Api.sharedReport( Doc.shareCredential , body ) : await Api.report( Doc.id , body );
      Ui.download( file.filename , file.blob );
      status.textContent = "";
    } catch ( error ) {
      status.textContent = "";
      Dom.toast( Ui.t( "report.failed" ) + " " + error.message , "error" );
    }
  },

  async drawnFigures( doc ) {
    await Figures.load( doc );
    const figures = [];
    for ( const f of this.figures( doc ) ) {
      const svg = f.make( true );
      const png = await Charts.png( svg , 2 ).then( ( blob ) => this.base64( blob ) ).catch( () => null );
      figures.push( { name: Charts.slug( f.name ) , svg: Charts.serialize( svg ) , png: png } );
    }
    return figures;
  },

  // -- the locked order ----------------------------------------------------------

  // A new seed, kept in the design. Everything drawn from it is the same
  // wherever it is compiled, so this is all a lock has to hold.
  lock() {
    Doc.change( Ui.t( "undo.order_shuffled" ) , ( d ) => {
      d.schedule = { seed: Compile.newSeed() || 1 , shuffled_at: new Date().toISOString() , shuffled_by: App.currentUser ? App.currentUser.display_name : "" };
    } );
  },

  async shuffle() {
    if ( Doc.doc.schedule.seed && !window.confirm( Ui.t( "report.lock_confirm" ) ) ) return;
    this.shuffling = true;
    try {
      this.lock();
      await this.publish();
    } catch ( error ) {
      Dom.toast( Ui.t( "report.publish_failed" ) + " " + error.message , "error" );
    } finally {
      this.shuffling = false;
      Designer.repaint( this.name );
    }
  },

  lockedGroups() {
    const doc = Doc.doc;
    return Compile.lockedGroups( doc , { id: Doc.id } , { seed: doc.schedule.seed , scanner: "wait" , revision: Doc.revision } );
  },

  lockedTable( group ) {
    const f = ( x ) => Tables.f( x , 2 );
    return {
      id: "locked-" + group.id , title: Ui.t( "report.lock_list" ).replace( "{name}" , group.name ),
      columns: [ Ui.t( "report.lock_col_run" ) , Ui.t( "report.lock_col_trial" ) , Ui.t( "report.lock_col_block" ) , Ui.t( "report.lock_col_type" ) , Ui.t( "report.lock_col_item" ) , Ui.t( "report.lock_col_onset" ) , Ui.t( "report.lock_col_phases" ) ],
      rows: Compile.schedule( group.plans ).map( ( r ) => [ r.run , r.trial , r.block , r.trial_type , r.item , f( r.onset ) , r.phases.map( ( p ) => p.name + " " + f( p.duration ) ).join( ", " ) ] ),
    };
  },

  async downloadRunFiles( group , button ) {
    button.disabled = true;
    try {
      const plans = Compile.forServer( group.plans );
      const file = Doc.shareCredential ? await Api.sharedBundle( Doc.shareCredential , plans ) : await Api.bundle( Doc.id , plans );
      Ui.download( file.filename , file.blob );
    } catch ( error ) {
      Dom.toast( error.message , "error" );
    } finally {
      button.disabled = false;
    }
  },

  // The one order this design plays until someone shuffles again.
  lockedCard() {
    const doc = Doc.doc;
    const locked = doc.schedule;
    const shuffle = Ui.button( Ui.t( locked.seed ? "report.lock_again" : "report.lock_first" ) , "shuffle" , () => this.shuffle() , { variant: "btn-primary" , editOnly: true , disabled: this.shuffling } );
    const parts = [ Ui.muted( Ui.t( "report.lock_help" ) ) ];
    const status = Dom.el( "div" , { class: "small mb-2" } );
    parts.push( status );
    const actions = Dom.el( "div" , { class: "row-actions align-items-center" , children: [ shuffle ] } );
    parts.push( actions );
    if ( this.shuffling ) {
      Dom.text( status , Ui.t( "report.building" ) );
      return Ui.section( Ui.t( "report.lock_heading" ) , parts );
    }
    if ( !locked.seed ) {
      Dom.text( status , Ui.t( "report.lock_none" ) );
      return Ui.section( Ui.t( "report.lock_heading" ) , parts );
    }
    const when = locked.shuffled_at ? new Date( locked.shuffled_at ).toLocaleString() : "";
    const said = Ui.t( "report.lock_when" ).replace( "{seed}" , locked.seed ).replace( "{when}" , when ).replace( "{who}" , locked.shuffled_by );
    Dom.text( status , said );
    if ( !Doc.shareCredential ) {
      Api.published( Doc.id ).then( ( row ) => {
        if ( row.seed !== locked.seed ) Dom.text( status , said + " " + Ui.t( "report.lock_unpublished" ) );
        else if ( row.revision !== Doc.revision ) Dom.text( status , said + " " + Ui.t( "report.lock_stale" ) );
      } ).catch( () => Dom.text( status , said + " " + Ui.t( "report.lock_unpublished" ) ) );
    }
    let groups = [];
    try {
      groups = this.lockedGroups();
    } catch ( error ) {
      parts.push( Ui.muted( Ui.t( "run.compile_failed" ) + " " + error.message , "mt-2" ) );
    }
    if ( !groups.length ) return Ui.section( Ui.t( "report.lock_heading" ) , parts );
    if ( !groups.some( ( g ) => g.id === this.lockedPick ) ) this.lockedPick = groups[ 0 ].id;
    const group = groups.find( ( g ) => g.id === this.lockedPick );
    const pick = Ui.select( group.id , groups.map( ( g ) => [ g.id , Ui.t( "report.lock_kind_" + g.kind ) + ": " + g.name ] ) , ( v ) => { this.lockedPick = v; Designer.repaint( this.name ); } , { key: "report.lockpick" , small: true } );
    pick.disabled = false;
    pick.classList.add( "w-auto" );
    const files = Ui.button( Ui.t( "report.lock_files" ) , "file-earmark-zip" , () => this.downloadRunFiles( group , files ) );
    actions.append(
      Ui.button( Ui.t( "report.lock_csv" ) , "filetype-csv" , () => Ui.download( Charts.slug( doc.name ) + "-order.csv" , new Blob( [ Compile.scheduleCsv( groups ) ] , { type: "text/csv" } ) ) ),
      pick , files,
    );
    parts.push( Dom.el( "div" , { class: "locked-list mt-3" , children: [ Tables.view( this.lockedTable( group ) ) ] } ) );
    return Ui.section( Ui.t( "report.lock_heading" ) , parts );
  },

  // -- publishing ---------------------------------------------------------------

  // Only this browser can compile a plan or draw a figure, so the addresses
  // serve what was sent here last, and the card says how old that is (see
  // app/models/published.py).
  publishCard() {
    const status = Dom.el( "div" , { class: "small mt-2" } );
    const links = Dom.el( "div" , { class: "mt-2" } );
    const paint = ( row ) => {
      links.replaceChildren();
      if ( !row ) {
        Dom.text( status , Ui.t( "report.publish_never" ) );
        return;
      }
      let text = Ui.t( "report.publish_when" ).replace( "{when}" , new Date( row.published_at ).toLocaleString() ).replace( "{who}" , row.published_by_name || "" ).replace( "{plans}" , row.plans.length ).replace( "{figures}" , row.figures.length );
      if ( row.revision !== Doc.revision ) text += " " + Ui.t( "report.publish_stale" );
      Dom.text( status , text );
      const base = window.location.origin + Api.experimentPath( Doc.id ) + "/published";
      const code = ( url ) => Dom.el( "div" , { class: "link-box mb-1" , children: [ Dom.el( "code" , { text: url } ) ] } );
      const details = Dom.el( "details" , { children: [ Dom.el( "summary" , { class: "small" , text: Ui.t( "report.publish_links" ) } ) ] } );
      details.append( code( base ) );
      row.plans.forEach( ( plan ) => details.append( code( base + "/plans/" + plan.label + ".json" ) ) );
      row.figures.forEach( ( name ) => details.append( code( base + "/figures/" + name ) ) );
      links.appendChild( details );
    };
    const button = Ui.button( Ui.t( "report.publish" ) , "broadcast" , async () => {
      button.disabled = true;
      Dom.text( status , Ui.t( "report.building" ) );
      try {
        paint( await this.publish() );
      } catch ( error ) {
        Dom.text( status , Ui.t( "report.publish_failed" ) + " " + error.message );
      } finally {
        button.disabled = false;
      }
    } , { editOnly: true } );
    Api.published( Doc.id ).then( paint ).catch( ( error ) => {
      if ( error.status === 404 ) paint( null );
      else Dom.text( status , error.message );
    } );
    return Ui.section( Ui.t( "report.publish_heading" ) , [ Ui.muted( Ui.t( "report.publish_help" ) ) , button , status , links ] );
  },

  // Every run and session, with one seed, and the figures, in parts small
  // enough for a request each. The last part makes it the published copy.
  async publish() {
    if ( !Doc.doc.schedule.seed ) this.lock();
    if ( Doc.dirty ) await Doc.save();
    const doc = Doc.doc;
    const seed = doc.schedule.seed;
    const options = { seed: seed , scanner: "wait" , revision: Doc.revision };
    const experiment = { id: Doc.id };
    const plans = [];
    doc.runs.forEach( ( run ) => plans.push( ...Compile.runPlans( doc , experiment , run.id , options ) ) );
    doc.sessions.forEach( ( session ) => plans.push( ...Compile.sessionPlans( doc , experiment , session.id , options ) ) );
    const parts = [];
    let part = { plans: [] , figures: [] , size: 0 };
    const add = ( key , entry ) => {
      const size = JSON.stringify( entry ).length;
      if ( part.size + size > this.PUBLISH_PART_BYTES && part.size > 0 ) {
        parts.push( part );
        part = { plans: [] , figures: [] , size: 0 };
      }
      part[ key ].push( entry );
      part.size += size;
    };
    Compile.forServer( plans ).filter( ( plan ) => plan.segments.length ).forEach( ( plan ) => add( "plans" , plan ) );
    ( await this.drawnFigures( doc ) ).forEach( ( figure ) => add( "figures" , figure ) );
    parts.push( part );
    let version = "";
    let row = null;
    for ( let i = 0; i < parts.length; i += 1 ) {
      const last = i === parts.length - 1;
      row = await Api.publish( Doc.id , { version: version , plans: parts[ i ].plans , figures: parts[ i ].figures , finish: last , seed: seed } );
      version = row.version;
    }
    return row;
  },

  base64( blob ) {
    return new Promise( ( resolve , reject ) => {
      const reader = new FileReader();
      reader.onload = () => resolve( String( reader.result ).replace( /^data:[^,]*,/ , "" ) );
      reader.onerror = reject;
      reader.readAsDataURL( blob );
    } );
  },

  // -- the methods paragraph ---------------------------------------------------

  // One sentence of what a scanner card says, leaving out what it does not.
  acquisition( name , ref ) {
    const t = ( key ) => Ui.t( "report.m_" + key );
    const a = Scanners.acquisition( ref );
    const details = [];
    if ( a.sequence ) details.push( a.sequence );
    if ( a.tr_ms ) details.push( t( "acq_tr" ).replace( "{value}" , a.tr_ms ) );
    if ( a.te_ms ) details.push( t( "acq_te" ).replace( "{value}" , a.te_ms ) );
    if ( a.flip ) details.push( t( "acq_flip" ).replace( "{value}" , a.flip ) );
    if ( a.voxel ) details.push( t( "acq_voxel" ).replace( "{value}" , a.voxel ) );
    if ( a.slices ) details.push( t( "acq_slices" ).replace( "{value}" , a.slices ) );
    if ( a.mb && Number( a.mb ) > 1 ) details.push( t( "acq_mb" ).replace( "{value}" , a.mb ) );
    return t( details.length ? "acquisition" : "acquisition_plain" ).replace( "{name}" , name ).replace( "{card}" , a.label ).replace( "{details}" , details.join( ", " ) );
  },

  methods( doc ) {
    const t = ( key ) => Ui.t( "report.m_" + key );
    const f = ( x ) => Tables.f( x , 2 );
    const tr = doc.scanner.tr;
    const parts = [];
    parts.push( t( "intro" ).replace( "{n}" , doc.trial_types.length ).replace( "{names}" , doc.trial_types.map( ( tt ) => "“" + tt.name + "”" ).join( ", " ) ) );
    doc.trial_types.forEach( ( tt ) => {
      const span = Timing.trial( doc , tt );
      const phases = tt.phases.map( ( p ) => p.name + " (" + Tables.durationText( p.duration , tr ) + ")" ).join( ", " );
      parts.push( t( "trial" ).replace( "{name}" , tt.name ).replace( "{phases}" , phases ).replace( "{mean}" , f( span.mean ) ) );
      tt.phases.forEach( ( p ) => {
        const d = p.duration;
        if ( d.kind === "fixed" ) return;
        const span1 = Timing.span( d , tr );
        const key = d.kind === "geometric" ? "geometric" : d.kind === "exponential" ? "exponential" : "uniform";
        parts.push( t( key ).replace( "{phase}" , p.name ).replace( "{trial}" , tt.name ).replace( "{min}" , f( span1.min ) ).replace( "{max}" , f( span1.max ) )
          .replace( "{mean}" , f( span1.mean ) ).replace( "{p}" , d.p ).replace( "{tr}" , tr ) );
      } );
    } );
    doc.runs.forEach( ( run ) => {
      const info = Timing.run( doc , run );
      parts.push( t( "run" ).replace( "{name}" , run.name ).replace( "{trials}" , info.trials ).replace( "{blocks}" , run.blocks.reduce( ( n , b ) => n + b.repeat , 0 ) )
        .replace( "{length}" , Timing.clock( info.total.mean ) ).replace( "{volumes}" , info.volumes.min === info.volumes.max ? info.volumes.min : info.volumes.min + "–" + info.volumes.max )
        .replace( "{tr}" , info.tr ).replace( "{dummies}" , info.dummy ) );
      if ( run.card ) parts.push( this.acquisition( run.name , run.card ) );
    } );
    const seen = new Set( doc.runs.map( ( run ) => run.card && run.card.id ) );
    doc.sessions.forEach( ( session ) => session.steps.forEach( ( step ) => {
      if ( !step.card || step.enabled === false || seen.has( step.card.id ) ) return;
      seen.add( step.card.id );
      parts.push( this.acquisition( step.name || step.card.label , step.card ) );
    } ) );
    const budget = Timing.budget( doc );
    const sessions = doc.sessions.reduce( ( n , s ) => n + s.count , 0 );
    if ( sessions ) {
      // The time in the scanner, whatever is charged to the hours.
      const each = budget.rows.reduce( ( sum , r ) => sum + r.functionalHours + r.overheadHours , 0 );
      parts.push( t( "sessions" ).replace( "{n}" , sessions ).replace( "{hours}" , f( each ) ).replace( "{participants}" , doc.budget.participants ).replace( "{total}" , Tables.f( each * doc.budget.participants , 1 ) ) );
    }
    const calendar = Timing.calendar( doc );
    if ( calendar.set ) parts.push( t( "calendar" ).replace( "{weeks}" , calendar.weeksNeeded ).replace( "{each}" , doc.budget.sessions_per_week ) );
    const regs = Efficiency.regressors( doc );
    if ( regs.length ) {
      const marks = Hrf.landmarks( doc.hrf );
      parts.push( t( "hrf" ).replace( "{regressors}" , regs.map( ( r ) => r.label ).join( ", " ) ).replace( "{peak}" , marks.peak.t.toFixed( 1 ) )
        .replace( "{trough}" , marks.trough.t.toFixed( 1 ) ).replace( "{ratio}" , doc.hrf.undershoot_ratio ) );
    }
    return parts.join( " " );
  },
};
