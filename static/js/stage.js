// The browser player: plays run plans full screen, the way the PsychoPy
// runner does (runner/fmri_runner/schedule.py).
//
// Time zero is the last trigger pulse. Every segment is an absolute offset
// from it, so error never accumulates. What is drawn in a frame callback
// appears on the next frame, so a segment is entered as soon as that next
// frame is within half a frame of its onset -- the same rule as the runner. The clock is virtual -- ×1 to ×30,
// pause, skip -- so a 10-minute run can be checked in a minute. Ported from
// the old planner's player, minus everything it knew about questions.
//
// Scanner modes: "wait" counts presses of the trigger key (dummy_volumes of
// them), "simulate" makes the pulses itself at the TR, "none" starts at once.
//
// The bug button opens a debug window: a filterable log of everything that
// happened, how far each onset landed from the plan, and a jump to any trial.
// The same is there from the console while a run plays: Stage.debug.
const Stage = {
  SPEEDS: [ 1 , 2 , 5 , 10 , 30 ],
  LOG_KEPT: 5000,
  LOG_SHOWN: 300,
  root: null,

  // For the console: Stage.debug.jump( 12 ), Stage.debug.log( "response" ).
  debug: {
    log( filter ) {
      return Stage.entries.filter( ( e ) => Stage.matches( e , filter || "" ) );
    },
    jump( trial ) { return Stage.jump( trial ); },
    skip() { Stage.skip(); },
    pause() { Stage.togglePause(); },
    speed( value ) { Stage.setSpeed( value ); },
    state() {
      return Stage.root ? { state: Stage.state , run: Stage.plan.run.label , t: Stage.now() , segment: Stage.segments[ Stage.idx ] || null , drift: Stage.driftSummary() } : null;
    },
  },

  // PsychoPy's key names, from a KeyboardEvent.
  keyName( event ) {
    const named = { " ": "space" , Escape: "escape" , Enter: "return" , Tab: "tab" , Backspace: "backspace" , ArrowLeft: "left" , ArrowRight: "right" , ArrowUp: "up" , ArrowDown: "down" };
    return named[ event.key ] || ( event.key.length === 1 ? event.key.toLowerCase() : event.key.toLowerCase() );
  },

  // plans: compiled run plans; options: { scanner, speed, mediaUrl, onClose }.
  play( plans , options ) {
    this.stop();
    this.plans = plans;
    this.options = options;
    this.planIndex = 0;
    this.results = [];
    this.entries = [];
    this.build();
    this.onKey = ( event ) => this.keydown( event );
    window.addEventListener( "keydown" , this.onKey , true );
    try {
      if ( this.root.requestFullscreen ) this.root.requestFullscreen().catch( () => {} );
    } catch ( error ) { /* windowed is fine */ }
    this.startPlan();
  },

  build() {
    const t = ( key ) => I18n.get( key );
    this.root = Dom.el( "div" , { class: "player-overlay" , attrs: { tabindex: "-1" } } );
    this.screen = Display.screen( 1.6 , true );
    this.message = Dom.el( "div" , { class: "player-message" } );
    this.hudText = Dom.el( "span" , { class: "player-hud-text" } );
    this.speed = Dom.el( "select" , { class: "form-select form-select-sm player-speed" , attrs: { "aria-label": t( "player.speed" ) } } );
    this.SPEEDS.forEach( ( s ) => {
      const option = Dom.el( "option" , { text: "×" + s } );
      option.value = String( s );
      this.speed.appendChild( option );
    } );
    this.speed.value = String( this.options.speed || 1 );
    this.speed.addEventListener( "change" , () => this.setSpeed( Number( this.speed.value ) ) );
    const button = ( icon , title , run ) => {
      const b = Dom.el( "button" , { class: "btn btn-sm btn-dark" , attrs: { type: "button" , title: title , "aria-label": title } , children: [ Dom.el( "i" , { class: "bi bi-" + icon } ) ] } );
      b.addEventListener( "click" , ( event ) => {
        event.stopPropagation();
        run();
        this.root.focus();
      } );
      return b;
    };
    this.pauseButton = button( "pause-fill" , t( "player.pause" ) , () => this.togglePause() );
    this.debugPanel = this.buildDebug();
    this.hud = Dom.el( "div" , { class: "player-hud" , children: [
      this.hudText,
      Dom.el( "span" , { class: "ms-auto d-flex gap-1 align-items-center" , children: [
        this.speed, this.pauseButton,
        button( "skip-end-fill" , t( "player.skip" ) , () => this.skip() ),
        button( "bug-fill" , t( "player.debug" ) , () => this.toggleDebug() ),
        button( "x-lg" , t( "player.stop" ) , () => this.close() ),
      ] } ),
    ] } );
    this.root.append( this.screen , this.message , this.hud , this.debugPanel );
    this.root.addEventListener( "click" , () => {
      if ( this.state === "instructions" || this.state === "between" ) this.advance();
    } );
    document.body.appendChild( this.root );
    this.root.focus();
  },

  // -- the debug window -------------------------------------------------------

  buildDebug() {
    const t = ( key ) => I18n.get( key );
    this.debugFilter = Dom.el( "input" , { class: "form-control form-control-sm" , attrs: { type: "search" , placeholder: t( "player.debug_filter" ) , "aria-label": t( "player.debug_filter" ) } } );
    this.debugFilter.addEventListener( "input" , () => this.paintLog() );
    this.debugJump = Dom.el( "input" , { class: "form-control form-control-sm player-debug-jump" , attrs: { type: "number" , min: "1" , step: "1" , placeholder: t( "player.trial" ) , "aria-label": t( "player.debug_jump" ) } } );
    const go = Dom.el( "button" , { class: "btn btn-sm btn-light" , text: t( "player.debug_jump" ) , attrs: { type: "button" } } );
    const jump = () => {
      if ( !this.jump( Number( this.debugJump.value ) ) ) this.addLog( "jump" , t( "player.debug_no_trial" ).replace( "{n}" , this.debugJump.value ) );
    };
    go.addEventListener( "click" , jump );
    this.debugJump.addEventListener( "keydown" , ( event ) => { if ( event.key === "Enter" ) jump(); } );
    this.debugSummary = Dom.el( "div" , { class: "small player-debug-summary" } );
    this.debugRows = Dom.el( "div" , { class: "player-debug-rows" } );
    const panel = Dom.el( "div" , { class: "player-debug" , attrs: { hidden: "hidden" } , children: [
      Dom.el( "div" , { class: "d-flex gap-1 mb-1" , children: [ this.debugFilter , this.debugJump , go ] } ),
      this.debugSummary, this.debugRows,
    ] } );
    // Clicks here are not the "click to continue" of the screen behind.
    panel.addEventListener( "click" , ( event ) => event.stopPropagation() );
    return panel;
  },

  toggleDebug() {
    this.debugPanel.hidden = !this.debugPanel.hidden;
    if ( !this.debugPanel.hidden ) this.paintLog();
  },

  matches( entry , filter ) {
    const needle = filter.trim().toLowerCase();
    return !needle || ( entry.kind + " " + entry.text ).toLowerCase().includes( needle );
  },

  addLog( kind , text , drift ) {
    const entry = { run: this.plan ? this.plan.run.label : "" , t: this.clock ? Timing.round4( this.now() ) : 0 , kind: kind , text: text , drift: drift == null ? null : drift };
    this.entries.push( entry );
    if ( this.entries.length > this.LOG_KEPT ) this.entries.shift();
    if ( this.debugPanel.hidden || !this.matches( entry , this.debugFilter.value ) ) return;
    this.debugRows.appendChild( this.logRow( entry ) );
    if ( this.debugRows.childElementCount > this.LOG_SHOWN ) this.debugRows.firstChild.remove();
    this.debugRows.scrollTop = this.debugRows.scrollHeight;
    this.paintDrift();
  },

  logRow( entry ) {
    return Dom.el( "div" , { class: "player-debug-row" , children: [
      Dom.el( "span" , { text: entry.t.toFixed( 2 ) } ),
      Dom.el( "span" , { class: "player-debug-kind" , text: entry.kind } ),
      Dom.el( "span" , { class: "player-debug-text" , text: entry.text } ),
      Dom.el( "span" , { text: entry.drift == null ? "" : ( entry.drift >= 0 ? "+" : "" ) + entry.drift.toFixed( 1 ) + " ms" } ),
    ] } );
  },

  paintLog() {
    const rows = this.entries.filter( ( e ) => this.matches( e , this.debugFilter.value ) ).slice( -this.LOG_SHOWN );
    this.debugRows.replaceChildren( ...rows.map( ( e ) => this.logRow( e ) ) );
    this.debugRows.scrollTop = this.debugRows.scrollHeight;
    this.paintDrift();
  },

  // Onset error in real milliseconds, whatever the playback speed.
  driftSummary() {
    const values = ( this.measured || [] ).map( ( m ) => Math.abs( m.onset - m.planned ) / this.clock.speed * 1000 );
    if ( !values.length ) return null;
    return { onsets: values.length , mean: values.reduce( ( a , b ) => a + b , 0 ) / values.length , worst: Math.max( ...values ) };
  },

  paintDrift() {
    const drift = this.driftSummary();
    this.debugSummary.textContent = drift ? I18n.get( "player.debug_drift" ).replace( "{n}" , drift.onsets ).replace( "{mean}" , drift.mean.toFixed( 1 ) ).replace( "{worst}" , drift.worst.toFixed( 1 ) ) : "";
  },

  // Go straight to a trial, by its number from 1. False if there is no such
  // trial, or the run is not under way.
  jump( number ) {
    if ( this.state !== "running" && this.state !== "paused" ) return false;
    const index = this.segments.findIndex( ( s ) => s.trial === number - 1 );
    if ( index < 0 ) return false;
    const onset = this.segments[ index ].onset;
    this.clock.base = onset;
    this.clock.anchor = performance.now();
    this.addLog( "jump" , I18n.get( "player.trial" ) + " " + number );
    this.enter( index , onset );
    return true;
  },

  // -- one plan ---------------------------------------------------------------

  startPlan() {
    const plan = this.plans[ this.planIndex ];
    this.plan = plan;
    this.segments = plan.segments.filter( ( s ) => s.kind !== "instructions" );
    this.instructions = plan.segments.filter( ( s ) => s.kind === "instructions" );
    this.idx = -1;
    this.pulses = 0;
    this.measured = [];
    this.responses = [];
    this.answered = null;
    this.frameMs = 1000 / 60;
    this.lastFrame = 0;
    this.clock = { base: 0 , anchor: 0 , speed: Number( this.speed.value ) || 1 , running: false };
    this.context = { background: plan.display.background , font: plan.display.font , mediaUrl: this.options.mediaUrl };
    this.raf = requestAnimationFrame( ( ts ) => this.frame( ts ) );
    this.addLog( "run" , plan.run.label + " · " + plan.run.name );
    if ( this.instructions.length ) {
      this.state = "instructions";
      Display.render( this.screen , this.instructions[ 0 ].layers , this.context );
      this.say( I18n.get( "player.press_to_start" ).replace( "{keys}" , plan.keys.advance.join( "/" ) ) );
    } else {
      this.waitForScanner();
    }
  },

  waitForScanner() {
    const plan = this.plan;
    Display.render( this.screen , [] , this.context );
    const needed = Math.max( 1 , plan.scanner.dummy_volumes );
    if ( this.options.scanner === "none" ) {
      this.say( "" );
      this.startClock();
      return;
    }
    this.state = "waiting";
    this.needed = needed;
    this.showWaiting();
    if ( this.options.scanner === "simulate" ) this.simulatePulse();
  },

  showWaiting() {
    const text = I18n.get( this.options.scanner === "simulate" ? "player.waiting_simulated" : "player.waiting" )
      .replace( "{seen}" , this.pulses ).replace( "{total}" , this.needed ).replace( "{key}" , this.plan.scanner.trigger_key );
    this.say( text );
  },

  simulatePulse() {
    window.clearTimeout( this.timer );
    this.pulse();
    if ( this.state === "waiting" ) {
      this.timer = window.setTimeout( () => this.simulatePulse() , ( this.plan.scanner.tr * 1000 ) / this.clock.speed );
    }
  },

  pulse() {
    this.pulses += 1;
    this.addLog( "pulse" , this.pulses + " / " + this.needed );
    this.showWaiting();
    if ( this.pulses >= this.needed ) this.startClock();
  },

  startClock() {
    window.clearTimeout( this.timer );
    this.clock.base = 0;
    this.clock.anchor = performance.now();
    this.clock.running = true;
    this.state = "running";
    this.addLog( "start" , "t0" );
    this.say( "" );
  },

  now( ms ) {
    const c = this.clock;
    return c.running ? c.base + ( ( ( ms == null ? performance.now() : ms ) - c.anchor ) / 1000 ) * c.speed : c.base;
  },

  rebase() {
    const at = performance.now();
    this.clock.base = this.now( at );
    this.clock.anchor = at;
  },

  setSpeed( speed ) {
    if ( !this.clock ) return;
    this.rebase();
    this.clock.speed = speed;
    this.speed.value = String( speed );
  },

  frame( ts ) {
    if ( !this.root ) return;
    this.raf = requestAnimationFrame( ( t ) => this.frame( t ) );
    if ( this.lastFrame ) {
      const gap = ts - this.lastFrame;
      if ( gap > 4 && gap < 100 ) this.frameMs = this.frameMs * 0.95 + gap * 0.05;
    }
    this.lastFrame = ts;
    if ( this.state === "running" ) {
      const t = this.now( ts );
      const half = ( this.frameMs / 1000 ) * this.clock.speed / 2;
      // Where the clock will be when what is drawn now reaches the screen.
      const shown = this.now( ts + this.frameMs );
      let i = Math.max( this.idx , 0 );
      while ( i < this.segments.length && shown >= this.segments[ i ].onset + this.segments[ i ].duration - half ) i += 1;
      if ( i >= this.segments.length ) {
        // A throttled tab (or ×30) can overshoot the end by a whole frame
        // gap; the run itself ended where the plan says.
        this.finishPlan( Math.min( t , this.plan.total_seconds ) );
        return;
      }
      if ( i !== this.idx ) this.enter( i , shown );
    }
    this.updateHud();
  },

  enter( i , t ) {
    this.idx = i;
    this.answered = null;
    const segment = this.segments[ i ];
    Display.render( this.screen , segment.layers , this.context );
    this.measured.push( { index: i , planned: segment.onset , onset: Timing.round4( t ) } );
    const what = [ segment.trial != null ? I18n.get( "player.trial" ) + " " + ( segment.trial + 1 ) : "" , segment.trial_type , segment.label , segment.item_label ].filter( Boolean ).join( " · " );
    this.addLog( segment.kind , what , ( t - segment.onset ) / this.clock.speed * 1000 );
  },

  finishPlan( t ) {
    this.state = "between";
    this.clock.running = false;
    this.addLog( "end" , this.plan.run.label );
    const drift = this.measured.map( ( m ) => ( m.onset - m.planned ) / this.clock.speed * 1000 );
    const trials = new Set( this.segments.filter( ( s ) => s.trial != null ).map( ( s ) => s.trial ) ).size;
    this.results.push( {
      label: this.plan.run.label , seconds: t , trials: trials , responses: this.responses.length,
      drift: drift.length ? drift.reduce( ( a , b ) => a + Math.abs( b ) , 0 ) / drift.length : 0,
    } );
    Display.render( this.screen , [] , this.context );
    const last = this.planIndex === this.plans.length - 1;
    const summary = I18n.get( "player.run_done" ).replace( "{label}" , this.plan.run.label ).replace( "{trials}" , trials ).replace( "{time}" , Timing.clock( t ) ).replace( "{responses}" , this.responses.length );
    this.say( summary + "\n\n" + I18n.get( last ? "player.all_done" : "player.next_run" ).replace( "{keys}" , this.plan.keys.advance.join( "/" ) ) );
  },

  // Instructions dismissed, or on to the next run.
  advance() {
    if ( this.state === "instructions" ) {
      this.waitForScanner();
    } else if ( this.state === "between" ) {
      if ( this.planIndex < this.plans.length - 1 ) {
        cancelAnimationFrame( this.raf );
        this.planIndex += 1;
        this.startPlan();
      } else {
        this.close();
      }
    }
  },

  togglePause() {
    if ( this.state === "running" ) {
      this.rebase();
      this.clock.running = false;
      this.state = "paused";
      this.pauseButton.firstChild.className = "bi bi-play-fill";
      this.addLog( "pause" , "" );
    } else if ( this.state === "paused" ) {
      this.clock.anchor = performance.now();
      this.clock.running = true;
      this.state = "running";
      this.pauseButton.firstChild.className = "bi bi-pause-fill";
      this.addLog( "resume" , "" );
    }
  },

  // End the current segment now; everything after it moves up.
  skip() {
    if ( this.state === "instructions" ) return this.advance();
    if ( this.state === "waiting" ) return this.startClock();
    if ( this.state !== "running" || this.idx < 0 ) return;
    const segment = this.segments[ this.idx ];
    const left = segment.onset + segment.duration - this.now();
    if ( left > 0 ) {
      this.rebase();
      this.clock.base += left;
      this.addLog( "skip" , segment.label );
    }
  },

  keydown( event ) {
    if ( !this.root ) return;
    // Typing in the debug window is not pressing keys at the task.
    if ( event.target.closest && event.target.closest( ".player-debug" ) ) return;
    const key = this.keyName( event );
    const plan = this.plan;
    if ( plan.keys.quit.includes( key ) ) {
      event.preventDefault();
      this.close();
      return;
    }
    if ( this.state === "instructions" || this.state === "between" ) {
      if ( plan.keys.advance.includes( key ) ) {
        event.preventDefault();
        this.advance();
      }
      return;
    }
    if ( this.state === "waiting" && this.options.scanner === "wait" && key === String( plan.scanner.trigger_key ) ) {
      event.preventDefault();
      this.pulse();
      return;
    }
    if ( this.state === "running" && this.idx >= 0 ) {
      const segment = this.segments[ this.idx ];
      if ( segment.response && segment.response.keys.includes( key ) && !this.answered ) {
        event.preventDefault();
        const t = this.now();
        this.answered = { key: key , t: t };
        this.responses.push( { segment: this.idx , key: key , rt: Timing.round4( t - segment.onset ) } );
        this.addLog( "response" , key + " · " + Timing.round4( t - segment.onset ) + " s" );
        if ( segment.response.ends_phase ) Display.render( this.screen , [] , this.context );
      }
    }
  },

  updateHud() {
    const plan = this.plan;
    let text = plan.run.label + ( this.plans.length > 1 ? " (" + ( this.planIndex + 1 ) + "/" + this.plans.length + ")" : "" );
    if ( this.state === "running" || this.state === "paused" ) {
      const segment = this.segments[ Math.max( this.idx , 0 ) ];
      const t = this.now();
      text += " · " + Timing.clock( t ) + " / " + Timing.clock( plan.total_seconds );
      if ( segment ) {
        if ( segment.trial != null ) text += " · " + I18n.get( "player.trial" ) + " " + ( segment.trial + 1 );
        text += " · " + ( segment.trial_type ? segment.trial_type + " › " : "" ) + segment.label;
        if ( segment.item_label ) text += " · “" + segment.item_label.slice( 0 , 40 ) + "”";
      }
      if ( this.state === "paused" ) text += " · " + I18n.get( "player.paused" );
    }
    if ( this.hudText.textContent !== text ) this.hudText.textContent = text;
  },

  say( text ) {
    this.message.textContent = text;
    this.message.hidden = !text;
  },

  close() {
    const done = this.options && this.options.onClose;
    this.stop();
    if ( done ) done( this.results );
  },

  stop() {
    if ( !this.root ) return;
    cancelAnimationFrame( this.raf );
    window.clearTimeout( this.timer );
    window.removeEventListener( "keydown" , this.onKey , true );
    if ( document.fullscreenElement ) document.exitFullscreen().catch( () => {} );
    this.root.remove();
    this.root = null;
  },
};
