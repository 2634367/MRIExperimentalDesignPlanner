// The one dialog every "Play" button opens, for a trial, a run or a whole
// session. Three ways to run the same compiled plans:
//
//   Play in browser      the player in this tab (stage.js)
//   Run in PsychoPy      starts PsychoPy on the machine this server runs on --
//                        offered only when the server says it can
//                        (GET /api/psychopy), and never on a share link
//   Download for PsychoPy a zip with the runner, the plans and the pictures,
//                        plus the command to run it, for any other machine
//
// The seed decides every jitter and every item drawn, so the same seed plays
// the same run everywhere. The dialog opens on the design's locked order if it
// has one (report.js), else on a new seed; the dice is for this play only.
const RunDialog = {
  status: null,
  statusPromise: null,

  psychopy( refresh ) {
    if ( Doc.shareCredential ) return Promise.resolve( { available: false , reason: "shared" } );
    if ( !this.statusPromise || refresh ) {
      this.statusPromise = Api.psychopyStatus( refresh ).then( ( s ) => ( this.status = s ) ).catch( () => ( { available: false , reason: "error" } ) );
    }
    return this.statusPromise;
  },

  remembered( key , fallback ) {
    try {
      return window.localStorage.getItem( "run-" + key ) || fallback;
    } catch ( error ) {
      return fallback;
    }
  },

  remember( key , value ) {
    try { window.localStorage.setItem( "run-" + key , value ); } catch ( error ) { /* not remembered */ }
  },

  // { title, kind: "trial" | "run" | "session", build( options ) -> plans }
  open( spec ) {
    const t = ( key ) => I18n.get( key );
    const locked = spec.kind === "trial" ? 0 : Doc.doc.schedule.seed;
    const state = {
      seed: locked || Compile.newSeed(),
      participant: this.remembered( "participant" , "" ),
      scanner: spec.kind === "trial" ? "none" : this.remembered( "scanner" , "simulate" ),
      windowed: spec.kind === "trial" || this.remembered( "windowed" , "1" ) === "1",
      speed: spec.kind === "trial" ? 1 : Number( this.remembered( "speed" , "1" ) ),
      screen: Number( this.remembered( "screen" , "0" ) ),
      flip: this.remembered( "flip" , "none" ),
      debug: false,
      blocks: 0,          // a pilot: only the first N blocks; 0 for all of them
      visit: 0,           // typed in; 0 means work it out
      nextVisit: 0,       // one past this participant's highest recorded visit
      seen: null,         // what this participant has been shown before
    };
    let plans = null;
    const summary = Dom.el( "div" , { class: "run-summary small" } );
    let visitInput = null;
    const compile = () => {
      try {
        plans = spec.build( {
          seed: state.seed , participant: state.participant , scanner: state.scanner , blocks: state.blocks , revision: Doc.revision,
          visit: state.visit || state.nextVisit , seen: state.seen ? new Set( state.seen.items ) : null,
        } );
      } catch ( error ) {
        plans = null;
        console.error( error );
        Dom.text( summary , t( "run.compile_failed" ) + " " + error.message );
        return;
      }
      if ( !plans.length ) {
        Dom.text( summary , t( "run.nothing" ) );
        return;
      }
      const seconds = plans.reduce( ( s , p ) => s + p.total_seconds , 0 );
      const trials = plans.reduce( ( s , p ) => s + new Set( p.segments.filter( ( x ) => x.trial != null ).map( ( x ) => x.trial ) ).size , 0 );
      const volumes = plans.map( ( p ) => Compile.acquired( Doc.doc , p ) ).join( " + " );
      let text = t( "run.summary" ).replace( "{runs}" , plans.length ).replace( "{trials}" , trials ).replace( "{time}" , Timing.clock( seconds ) ).replace( "{volumes}" , volumes );
      const reused = ( plans[ 0 ].warnings || [] ).filter( ( w ) => w.kind === "reused" );
      if ( reused.length ) text += " " + t( "run.items_reused" ).replace( "{lists}" , Array.from( new Set( reused.map( ( w ) => w.list ) ) ).join( ", " ) );
      if ( state.seen && state.seen.runs ) text += " " + t( "run.items_seen" ).replace( "{items}" , state.seen.items.length ).replace( "{runs}" , state.seen.runs );
      const seenAgain = ( plans[ 0 ].warnings || [] ).filter( ( w ) => w.kind === "seen_before" );
      if ( seenAgain.length ) text += " " + t( "run.items_seen_again" ).replace( "{lists}" , Array.from( new Set( seenAgain.map( ( w ) => w.list ) ) ).join( ", " ) );
      if ( plans.some( ( p ) => p.pilot_blocks ) ) text += " " + t( "run.pilot_note" );
      Dom.text( summary , text );
      if ( visitInput && plans[ 0 ].visit ) visitInput.placeholder = String( plans[ 0 ].visit );
    };

    // Whose history to draw against: a new answer for each participant. A
    // slower answer for someone since replaced is ignored.
    let seenAsked = 0;
    const loadSeen = async () => {
      const asked = ( seenAsked += 1 );
      state.seen = null;
      state.nextVisit = 0;
      if ( state.participant && !Doc.shareCredential && spec.kind !== "trial" ) {
        try {
          const row = await Api.seen( Doc.id , state.participant );
          if ( asked !== seenAsked ) return;
          state.seen = row;
          state.nextVisit = row.highest_visit ? row.highest_visit + 1 : 0;
        } catch ( error ) {
          Dom.toast( error.message , "error" );
        }
      }
      compile();
    };

    const seedInput = Ui.input( "number" , state.seed , ( v ) => {
      state.seed = Math.max( 0 , Math.round( Number( v ) ) || 0 );
      compile();
    } , { min: 0 , step: 1 } );
    seedInput.disabled = false;
    const dice = Ui.icon( "dice-5" , t( "run.new_seed" ) , () => {
      state.seed = Compile.newSeed();
      seedInput.value = String( state.seed );
      compile();
    } );
    const participant = Ui.text( state.participant , ( v ) => {
      state.participant = v.trim().slice( 0 , 64 );
      this.remember( "participant" , state.participant );
      loadSeen();
    } , { placeholder: t( "run.participant_placeholder" ) } );
    participant.disabled = false;
    const scanner = Ui.select( state.scanner , [ "wait" , "simulate" , "none" ].map( ( m ) => [ m , t( "run.scanner_" + m ) ] ) , ( v ) => {
      state.scanner = v;
      if ( spec.kind !== "trial" ) this.remember( "scanner" , v );
    } );
    scanner.disabled = false;
    const speed = Ui.select( String( state.speed ) , Stage.SPEEDS.map( ( s ) => [ String( s ) , "×" + s ] ) , ( v ) => {
      state.speed = Number( v );
      this.remember( "speed" , v );
    } );
    speed.disabled = false;
    const windowed = Ui.check( state.windowed , t( "run.windowed" ) , ( v ) => {
      state.windowed = v;
      this.remember( "windowed" , v ? "1" : "0" );
    } );
    windowed.querySelector( "input" ).disabled = false;
    const whole = ( v , limit ) => Math.max( 0 , Math.min( limit , Math.round( Number( v ) ) || 0 ) );
    visitInput = Ui.input( "number" , "" , ( v ) => {
      state.visit = whole( v , 999 );
      compile();
    } , { min: 1 , max: 999 , step: 1 } );
    visitInput.disabled = false;
    const blocksInput = Ui.input( "number" , "" , ( v ) => {
      state.blocks = whole( v , 10000 );
      compile();
    } , { min: 1 , step: 1 , placeholder: t( "run.blocks_all" ) } );
    blocksInput.disabled = false;
    const screenInput = Ui.input( "number" , state.screen , ( v ) => {
      state.screen = whole( v , 15 );
      this.remember( "screen" , String( state.screen ) );
    } , { min: 0 , max: 15 , step: 1 } );
    screenInput.disabled = false;
    const flip = Ui.select( state.flip , [ "none" , "horizontal" , "vertical" , "both" ].map( ( way ) => [ way , t( "run.flip_" + way ) ] ) , ( v ) => {
      state.flip = v;
      this.remember( "flip" , v );
    } );
    flip.disabled = false;
    const debug = Ui.check( state.debug , t( "run.debug" ) , ( v ) => { state.debug = v; } );
    debug.querySelector( "input" ).disabled = false;

    const psychopyBox = Dom.el( "div" , { class: "psychopy-box mt-3" } );
    const launchStatus = Dom.el( "div" , { class: "launch-status mt-2" , attrs: { hidden: "hidden" } } );
    const commandBox = Dom.el( "div" , { class: "mt-2" , attrs: { hidden: "hidden" } } );

    const playButton = Ui.button( t( "run.play_browser" ) , "play-fill" , () => {
      if ( !plans ) return;
      const toPlay = plans;
      bootstrap.Modal.getInstance( document.querySelector( ".modal.show" ) ).hide();
      Stage.play( toPlay , {
        scanner: state.scanner , speed: state.speed,
        mediaUrl: ( sha ) => Doc.mediaUrl( sha ),
        onClose: ( results ) => {
          const done = results.map( ( r ) => r.label + ": " + r.trials + " " + t( "player.trials" ) + " · " + Timing.clock( r.seconds ) + ( r.drift ? " · " + t( "player.drift" ) + " " + r.drift.toFixed( 1 ) + " ms" : "" ) );
          if ( done.length ) Dom.toast( done.join( " | " ) , "ok" );
        },
      } );
    } , { variant: "btn-primary" } );

    const launchButton = Ui.button( t( "run.launch" ) , "display" , async () => {
      if ( !plans ) return;
      launchButton.disabled = true;
      try {
        const row = await Api.launch( Doc.id , {
          plans: Compile.forServer( plans ) , scanner: state.scanner , windowed: state.windowed , label: spec.title,
          screen: state.screen , debug: state.debug , flip: state.flip,
        } );
        this.watch( row , launchStatus );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      } finally {
        launchButton.disabled = false;
      }
    } , { variant: "btn-success" } );
    launchButton.hidden = true;

    const downloadButton = Ui.button( t( "run.download" ) , "file-earmark-zip" , async () => {
      if ( !plans ) return;
      downloadButton.disabled = true;
      try {
        const forServer = Compile.forServer( plans );
        const file = Doc.shareCredential ? await Api.sharedBundle( Doc.shareCredential , forServer ) : await Api.bundle( Doc.id , forServer );
        Ui.download( file.filename , file.blob );
        this.showCommand( commandBox , file.filename , state );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      } finally {
        downloadButton.disabled = false;
      }
    } );

    const results = this.resultsButton();
    const fields = [
      Ui.field( "run.participant" , participant , { col: "col-md-4" } ),
      Ui.field( "run.seed" , Dom.el( "div" , { class: "input-group" , children: [ seedInput , dice ] } ) , { col: "col-md-3" , help: locked ? t( "run.seed_locked" ) : "" } ),
    ];
    if ( spec.kind !== "trial" ) fields.push( Ui.field( "run.scanner" , scanner , { col: "col-md-5" } ) );
    const options = Ui.row( fields );
    const extra = Ui.row( [
      spec.kind === "trial" ? null : Ui.field( "run.speed" , speed , { col: "col-6 col-md-3" , help: t( "run.speed_help" ) } ),
      spec.kind === "session" ? Ui.field( "run.visit" , visitInput , { col: "col-6 col-md-3" , help: t( "run.visit_help" ) } ) : null,
      spec.kind === "trial" ? null : Ui.field( "run.blocks" , blocksInput , { col: "col-6 col-md-3" , help: t( "run.blocks_help" ) } ),
      Ui.field( "run.screen" , screenInput , { col: "col-6 col-md-3" , help: t( "run.screen_help" ) } ),
      Ui.field( "run.flip" , flip , { col: "col-6 col-md-3" , help: t( "run.flip_help" ) } ),
    ] , "mt-1" );
    const switches = Ui.row( [
      Dom.el( "div" , { class: "col-md-5" , children: [ windowed ] } ),
      spec.kind === "trial" ? null : Dom.el( "div" , { class: "col-md-7" , children: [ debug ] } ),
    ] , "mt-1" );
    const actions = Dom.el( "div" , { class: "row-actions mt-3" , children: [ playButton , launchButton , downloadButton , results ].filter( Boolean ) } );
    const body = Dom.el( "div" , { children: [ options , extra , switches , Dom.el( "div" , { class: "mt-3" , children: [ summary ] } ) , actions , psychopyBox , launchStatus , commandBox ] } );

    compile();
    if ( state.participant ) loadSeen();
    psychopyBox.appendChild( Ui.muted( t( "run.checking_psychopy" ) ) );
    this.psychopy().then( ( status ) => {
      psychopyBox.replaceChildren();
      if ( status.available ) {
        launchButton.hidden = false;
        psychopyBox.appendChild( Ui.muted( t( "run.psychopy_found" ).replace( "{version}" , status.psychopy_version ).replace( "{where}" , status.source ) ) );
        if ( status.keyboard === "blocked" ) psychopyBox.appendChild( Ui.muted( t( "run.keyboard_blocked" ) ) );
        Api.latestLaunch().then( ( row ) => { if ( row && row.running ) this.watch( row , launchStatus ); } ).catch( () => {} );
      } else {
        psychopyBox.appendChild( Ui.muted( t( "run.psychopy_reason_" + status.reason ) || t( "run.psychopy_unavailable" ) ) );
        if ( status.reason === "not_installed" ) {
          psychopyBox.appendChild( Ui.button( t( "run.recheck" ) , "arrow-repeat" , async () => {
            psychopyBox.replaceChildren( Ui.muted( t( "run.checking_psychopy" ) ) );
            const again = await this.psychopy( true );
            if ( again.available ) {
              launchButton.hidden = false;
              psychopyBox.replaceChildren( Ui.muted( t( "run.psychopy_found" ).replace( "{version}" , again.psychopy_version ).replace( "{where}" , again.source ) ) );
            } else {
              psychopyBox.replaceChildren( Ui.muted( t( "run.psychopy_reason_" + again.reason ) ) );
            }
          } , { small: true } ) );
        }
      }
    } );

    Ui.dialog( {
      title: t( "run.title_" + spec.kind ).replace( "{name}" , spec.title ) , body: body , size: "modal-lg",
      buttons: [ { text: t( "ui.close" ) } ],
      onShow: () => {
        this.dialogOpen = true;
      },
    } ).then( () => {
      this.dialogOpen = false;
      window.clearTimeout( this.pollTimer );
    } );
  },

  // Run records brought back from another machine, so what a bundle showed
  // counts as seen too. Only what app/models/seen.py needs of each file goes
  // to the server. Hidden on a share link, which cannot write.
  resultsButton() {
    const t = ( key ) => I18n.get( key );
    if ( Doc.shareCredential ) return null;
    const picker = Dom.el( "input" , { attrs: { type: "file" , accept: ".json" , multiple: "multiple" , hidden: "hidden" } } );
    picker.addEventListener( "change" , async () => {
      const files = Array.from( picker.files );
      picker.value = "";
      const runs = [];
      for ( const file of files ) {
        try {
          const run = this.runSummary( JSON.parse( await file.text() ) );
          if ( run ) runs.push( run );
        } catch ( error ) { /* not a run record: skipped, and counted below */ }
      }
      try {
        const row = runs.length ? await Api.addSeen( Doc.id , runs ) : { added: 0 };
        Dom.toast( t( "run.results_added" ).replace( "{added}" , row.added ).replace( "{files}" , files.length ) , "ok" );
      } catch ( error ) {
        Dom.toast( error.message , "error" );
      }
    } );
    const button = Ui.button( t( "run.results" ) , "upload" , () => picker.click() , { title: t( "run.results_help" ) } );
    return Dom.el( "span" , { children: [ picker , button ] } );
  },

  // The browser's copy of seen.summarise: the same answer, without sending a
  // whole plan to the server to get it.
  runSummary( record ) {
    const plan = record && record.plan;
    if ( !plan || !plan.run || !plan.run.label ) return null;
    const participant = record.participant || plan.participant;
    if ( plan.run.label.startsWith( "trial-" ) || plan.pilot_blocks || !participant ) return null;
    return {
      experiment: plan.experiment ? plan.experiment.id : "" , participant: participant,
      run: plan.run.label + "@" + record.started , items: record.shown_items || [] , visit: plan.visit || 0,
    };
  },

  showCommand( box , filename , state ) {
    const folder = filename.replace( /\.zip$/ , "" );
    const flags = [];
    if ( state.scanner !== "wait" ) flags.push( "--scanner " + state.scanner );
    if ( state.windowed ) flags.push( "--windowed" );
    if ( state.screen ) flags.push( "--screen " + state.screen );
    if ( state.flip !== "none" ) flags.push( "--flip " + state.flip );
    if ( state.debug ) flags.push( "--debug" );
    if ( state.participant ) flags.push( "--participant " + state.participant.replace( /[^A-Za-z0-9_-]/g , "" ) );
    const tail = flags.length ? " " + flags.join( " " ) : "";
    const mac = "cd ~/Downloads && unzip -o " + filename + " && " + folder + "/run.sh" + tail;
    const win = folder + "\\run.bat" + tail;
    const code = ( text ) => {
      const node = Dom.el( "code" , { text: text } );
      return Dom.el( "div" , { class: "link-box mb-2" , children: [ node , Ui.button( I18n.get( "ui.copy" ) , "clipboard" , () => Dom.copy( node ) , { small: true } ) ] } );
    };
    box.replaceChildren(
      Ui.muted( I18n.get( "run.command_help" ) ),
      Dom.el( "div" , { class: "small fw-semibold" , text: I18n.get( "run.command_mac" ) } ), code( mac ),
      Dom.el( "div" , { class: "small fw-semibold" , text: I18n.get( "run.command_windows" ) } ), code( win ),
    );
    box.hidden = false;
  },

  // Follow a launch until it ends: state, the end of its log, a Stop button.
  watch( row , box ) {
    window.clearTimeout( this.pollTimer );
    const paint = ( current ) => {
      box.hidden = false;
      const state = current.running ? I18n.get( "run.launch_running" )
        : current.stopped ? I18n.get( "run.launch_stopped" )
        : current.exit_code === 0 ? I18n.get( "run.launch_done" ) : I18n.get( "run.launch_failed" ).replace( "{code}" , current.exit_code );
      const children = [
        Dom.el( "div" , { class: "d-flex align-items-center gap-2 mb-1" , children: [
          Dom.badge( state , current.running ? "primary" : current.exit_code === 0 ? "success" : "danger" ),
          Dom.el( "span" , { class: "small text-body-secondary text-truncate" , text: current.folder } ),
        ] } ),
        Dom.el( "pre" , { class: "launch-log" , text: ( current.log || [] ).join( "" ) || "…" } ),
      ];
      if ( current.running ) {
        children[ 0 ].appendChild( Ui.button( I18n.get( "run.stop" ) , "stop-fill" , async () => {
          try { paint( await Api.stopLaunch( current.id ) ); } catch ( error ) { Dom.toast( error.message , "error" ); }
        } , { small: true , variant: "btn-outline-danger" } ) );
      }
      box.replaceChildren( ...children );
      const log = box.querySelector( ".launch-log" );
      log.scrollTop = log.scrollHeight;
      if ( current.running && this.dialogOpen !== false ) {
        this.pollTimer = window.setTimeout( async () => {
          try { paint( await Api.getLaunch( current.id ) ); } catch ( error ) { /* stop polling */ }
        } , 1000 );
      }
    };
    paint( row );
  },
};
