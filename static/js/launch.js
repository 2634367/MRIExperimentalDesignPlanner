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
// the same run everywhere; a new one is drawn each time the dialog opens.
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
    const state = {
      seed: Compile.newSeed(),
      participant: this.remembered( "participant" , "" ),
      scanner: spec.kind === "trial" ? "none" : this.remembered( "scanner" , "simulate" ),
      windowed: spec.kind === "trial" || this.remembered( "windowed" , "1" ) === "1",
      speed: spec.kind === "trial" ? 1 : Number( this.remembered( "speed" , "1" ) ),
    };
    let plans = null;
    const summary = Dom.el( "div" , { class: "run-summary small" } );
    const compile = () => {
      try {
        plans = spec.build( { seed: state.seed , participant: state.participant , scanner: state.scanner } );
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
      const volumes = plans.map( ( p ) => p.volumes ).join( " + " );
      let text = t( "run.summary" ).replace( "{runs}" , plans.length ).replace( "{trials}" , trials ).replace( "{time}" , Timing.clock( seconds ) ).replace( "{volumes}" , volumes );
      const reused = ( plans[ 0 ].warnings || [] ).filter( ( w ) => w.kind === "reused" );
      if ( reused.length ) text += " " + t( "run.items_reused" ).replace( "{lists}" , Array.from( new Set( reused.map( ( w ) => w.list ) ) ).join( ", " ) );
      Dom.text( summary , text );
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
      compile();
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

    const fields = [
      Ui.field( "run.participant" , participant , { col: "col-md-4" } ),
      Ui.field( "run.seed" , Dom.el( "div" , { class: "input-group" , children: [ seedInput , dice ] } ) , { col: "col-md-3" } ),
    ];
    if ( spec.kind !== "trial" ) fields.push( Ui.field( "run.scanner" , scanner , { col: "col-md-5" } ) );
    const options = Ui.row( fields );
    const extra = Ui.row( [
      spec.kind === "trial" ? null : Ui.field( "run.speed" , speed , { col: "col-6 col-md-3" , help: t( "run.speed_help" ) } ),
      Dom.el( "div" , { class: "col-6 col-md-4" , children: [ windowed ] } ),
    ] , "mt-1" );
    const actions = Dom.el( "div" , { class: "row-actions mt-3" , children: [ playButton , launchButton , downloadButton ] } );
    const body = Dom.el( "div" , { children: [ options , extra , Dom.el( "div" , { class: "mt-3" , children: [ summary ] } ) , actions , psychopyBox , launchStatus , commandBox ] } );

    compile();
    psychopyBox.appendChild( Ui.muted( t( "run.checking_psychopy" ) ) );
    this.psychopy().then( ( status ) => {
      psychopyBox.replaceChildren();
      if ( status.available ) {
        launchButton.hidden = false;
        psychopyBox.appendChild( Ui.muted( t( "run.psychopy_found" ).replace( "{version}" , status.psychopy_version ).replace( "{where}" , status.source ) ) );
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

  showCommand( box , filename , state ) {
    const folder = filename.replace( /\.zip$/ , "" );
    const flags = [];
    if ( state.scanner !== "wait" ) flags.push( "--scanner " + state.scanner );
    if ( state.windowed ) flags.push( "--windowed" );
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
