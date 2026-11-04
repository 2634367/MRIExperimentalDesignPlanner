// Opening files from the two projects this app replaced:
//
//   the MRI Experimental Design Planner's design JSON (presets/*.json, or
//   design.json from one of its exports) -- its trials, runs and sessions
//   become trial types, runs and sessions here;
//
//   the Inner Speech task's question bank (questions/bank.json) -- it
//   becomes a prompt list. "shapes" questions are drawn once into a
//   transparent full-screen picture, exactly where the old task drew them,
//   so a picture layer at the centre, 1 screen tall, shows them unchanged.
//   Their text goes in a "title" column instead of "text", because the old
//   task moved it up out of the shapes' way; a trial type shows {text} in the
//   middle and {title} at the top, and whichever is empty is not drawn.
//
// The old Jitter sampling card (mode, p, truncation) becomes each jittered
// phase's own duration kind. A file without one is jittered geometrically,
// the default here; a cap of nMaxCap TRs becomes each phase's max once the
// runs have given the TR.
//
// The old optimiser's settings (solve modes, HRF objectives, caps,
// contingency) have no counterpart and are dropped; the import report lists
// everything that did not come across, so nothing disappears silently.
//
// The old runs and structural scans named their scanner card by slug
// ("EPI-TR2000-Task"); those slugs are the card ids in the shared library
// (static/js/scanners.js), so each run takes its TR, and each scan its
// length, from the card itself.
const Legacy = {
  isOldDesign( data ) {
    return Boolean( data && typeof data === "object" && !data.format_version && ( Array.isArray( data.trials ) || data.aims ) );
  },

  isBank( data ) {
    const items = Array.isArray( data ) ? data : data && Array.isArray( data.questions ) ? data.questions : null;
    return Boolean( items && items.length && items[ 0 ] && ( "view" in items[ 0 ] || "uuid" in items[ 0 ] ) && "text" in items[ 0 ] );
  },

  // "EPI-TR2000-Task" -> 2.
  trFromProtocol( slug ) {
    const match = /TR(\d+(?:\.\d+)?)/i.exec( slug || "" );
    if ( !match ) return 0;
    const value = Number( match[ 1 ] );
    return value > 30 ? value / 1000 : value;
  },

  // cards: the scanner card library, [] when it could not be loaded.
  convertDesign( old , cards ) {
    const t = ( key ) => I18n.get( key );
    const notes = [];
    if ( old.aims && !old.trials ) throw new Error( t( "legacy.too_old" ) );
    const library = Array.isArray( cards ) ? cards : [];
    const cardFor = ( slug ) => library.find( ( c ) => c.id === slug ) || null;
    const missingCards = new Set();
    const meta = old.meta || {};
    const jitter = old.jitter || { mode: Schema.DEFAULT_JITTER };
    const presentation = old.presentation || {};
    // An empty fixation would leave every fixation phase and rest blank.
    const fixationText = presentation.fixation && typeof presentation.fixation.text === "string" && presentation.fixation.text.trim() ? presentation.fixation.text : "+";
    const fixationHeight = Number( presentation.fixation && presentation.fixation.height ) || 0.08;
    const cueHeight = Number( presentation.cue && presentation.cue.height ) || 0.12;
    const roles = Array.isArray( old.roles ) && old.roles.length ? old.roles : [ { name: "primary" , shape: "✚" } ];
    const primary = roles[ 0 ];
    const screens = presentation.screens || {};

    const doc = Schema.blank( meta.studyTitle || ( old.experiments && old.experiments[ 0 ] && old.experiments[ 0 ].name ) || t( "legacy.untitled" ) );
    doc.notes = [
      [ meta.investigator , meta.institution , meta.designId ].filter( ( v ) => v && v !== "-" ).join( " · " ),
      meta.notes || "",
    ].filter( Boolean ).join( " — " );
    const budget = old.budget || {};
    doc.budget.hours_available = Number( budget.totalScannerHours ) || 10;
    doc.budget.participants = 1;

    // The question list the old task drew from lives outside the design;
    // make the list here, empty, ready for its bank.json.
    const usesQuestions = ( old.trials || [] ).some( ( trial ) => ( trial.phases || [] ).some( ( p ) => p.shows === "question" ) );
    let list = null;
    if ( usesQuestions ) {
      list = Schema.list( t( "legacy.questions_list" ) );
      list.columns = [
        Schema.column( "Text" , "text" ), Schema.column( "Image" , "image" , [ "text" ] ),
        Schema.column( "Answer" , "text" , [ "text" , "image" ] ), Schema.column( "Category" , "text" , [ "text" , "image" , "answer" ] ),
      ];
      doc.lists.push( list );
      notes.push( t( "legacy.note_bank" ) );
    }

    const fixation = () => [ Schema.textLayer( fixationText , fixationHeight ) ];
    const layersFor = ( shows ) => {
      if ( shows === "fixation" ) return fixation();
      if ( shows === "question" ) return [ Schema.textLayer( "{text}" , 0.06 ) , Object.assign( Schema.imageLayer( "{image}" ) , { pos: [ 0 , 0 ] , height: 1 } ) ];
      if ( shows === "cue" ) return primary.shape ? [ Schema.textLayer( primary.shape , cueHeight ) ] : [];
      if ( shows === "blank" || !shows ) return [];
      const screen = screens[ shows ];
      if ( screen && screen.text ) return [ Object.assign( Schema.textLayer( screen.text , screen.height || 0.06 ) , { pos: screen.pos || [ 0 , 0 ] } ) ];
      if ( screen && screen.image ) notes.push( t( "legacy.note_screen_image" ).replace( "{name}" , shows ).replace( "{path}" , screen.image ) );
      return [];
    };

    const trialIds = {};
    ( old.trials || [] ).forEach( ( trial ) => {
      const tt = Schema.trialType( trial.name || t( "trials.default_name" ) );
      tt.notes = trial.note || "";
      tt.color = [ "#4c78a8" , "#f58518" , "#54a24b" , "#e45756" , "#72b7b2" , "#b279a2" ][ doc.trial_types.length % 6 ];
      // A question phase that plays a sound (the perceived-speech control):
      // this app has no audio, so it shows the fixation instead of a question.
      const audio = ( phase ) => phase.shows === "question" && /audio|sound|listen/i.test( phase.name || "" );
      tt.phases = ( trial.phases || [] ).map( ( phase ) => {
        const lo = Number( phase.min ) || 0;
        const hi = Math.max( lo , Number( phase.max ) || lo );
        let duration;
        if ( hi > lo && phase.jitter !== false ) {
          duration = Schema.duration( jitter.mode === "geometric" ? "geometric" : jitter.mode === "exponential" ? "exponential" : "uniform" , lo , hi );
          if ( jitter.p ) duration.p = jitter.p;
        } else {
          duration = Schema.duration( "fixed" , hi > lo ? ( lo + hi ) / 2 : lo );
        }
        if ( audio( phase ) ) notes.push( t( "legacy.note_audio" ).replace( "{trial}" , tt.name ).replace( "{phase}" , phase.name ) );
        const made = Schema.phase( phase.name || "" , duration , audio( phase ) ? fixation() : layersFor( phase.shows ) );
        // The old regressor roles: a stimulus or response phase was modelled.
        made.modelled = [ "stimulus" , "response" , "question" , "cue" , "answer" ].includes( String( phase.role || "" ).toLowerCase() );
        return made;
      } );
      if ( ( trial.phases || [] ).some( ( p ) => p.shows === "question" && !audio( p ) ) && list ) {
        tt.list = list.id;
        tt.balance_by = "answer";
      }
      if ( Number( trial.controlPct ) > 0 ) notes.push( t( "legacy.note_control" ).replace( "{trial}" , tt.name ).replace( "{pct}" , trial.controlPct ) );
      trialIds[ trial.id ] = tt.id;
      doc.trial_types.push( tt );
    } );
    const unused = roles.slice( 1 ).map( ( r ) => r.name ).filter( Boolean );
    if ( unused.length ) notes.push( t( "legacy.note_roles" ).replace( "{cue}" , primary.shape || "" ).replace( "{roles}" , unused.join( ", " ) ) );

    const leadLayers = ( which ) => {
      const show = presentation.run && presentation.run[ which ] ? presentation.run[ which ].show : "fixation";
      return layersFor( show );
    };
    const runIds = {};
    ( old.runs || [] ).forEach( ( oldRun ) => {
      const run = Schema.run( oldRun.name || t( "runs.default_name" ) );
      run.notes = oldRun.note || "";
      const card = cardFor( oldRun.protocol );
      if ( card ) {
        run.card = Scanners.ref( card );
        run.tr = run.card.tr || this.trFromProtocol( oldRun.protocol );
      } else {
        if ( oldRun.protocol ) missingCards.add( oldRun.protocol );
        run.tr = this.trFromProtocol( oldRun.protocol );
      }
      run.dummy_volumes = Number.isFinite( Number( oldRun.dummyVolumes ) ) ? Number( oldRun.dummyVolumes ) : -1;
      run.instructions.enabled = false;
      run.lead_in = { seconds: Number( oldRun.leadIn ) || 0 , layers: leadLayers( "lead_in" ) };
      run.lead_out = { seconds: Number( oldRun.leadOut ) || 0 , layers: leadLayers( "lead_out" ) };
      const block = Schema.block( trialIds[ oldRun.trial ] || "" );
      const trialType = doc.trial_types.find( ( tt ) => tt.id === trialIds[ oldRun.trial ] );
      block.name = trialType ? trialType.name : "";
      block.mix[ 0 ].count = Number( oldRun.trialsPerBlock ) || 1;
      block.repeat = Number( oldRun.blocksPerRun ) || 1;
      block.order = "fixed";
      block.rest_after = { seconds: Number( oldRun.interBlockRest ) || 0 , layers: fixation() };
      run.blocks = [ block ];
      if ( Number( oldRun.interTrialGap ) > 0 ) notes.push( t( "legacy.note_gap" ).replace( "{run}" , run.name ).replace( "{seconds}" , oldRun.interTrialGap ) );
      runIds[ oldRun.id ] = run.id;
      doc.runs.push( run );
    } );
    if ( old.runs && old.runs.length ) {
      const trs = doc.runs.map( ( r ) => r.tr ).filter( Boolean );
      if ( trs.length ) doc.scanner.tr = trs[ 0 ];
    }
    const cap = Number( jitter.nMaxCap );
    if ( jitter.mode === "geometric" && jitter.truncation === "trs" && cap >= 0 ) {
      doc.trial_types.forEach( ( tt ) => tt.phases.forEach( ( phase ) => {
        const d = phase.duration;
        if ( d.kind === "geometric" ) d.max = Math.min( d.max , Timing.round4( d.min + Math.round( cap ) * doc.scanner.tr ) );
      } ) );
      notes.push( t( "legacy.note_jitter_cap" ).replace( "{n}" , Math.round( cap ) ).replace( "{tr}" , doc.scanner.tr ) );
    }

    // Session counts come from the old experiments' plans.
    const counts = {};
    ( old.experiments || [] ).forEach( ( experiment ) => ( experiment.plan || [] ).forEach( ( entry ) => {
      counts[ entry.session ] = ( counts[ entry.session ] || 0 ) + ( Number( entry.count ) || 0 );
    } ) );
    ( old.sessions || [] ).forEach( ( oldSession ) => {
      const session = Schema.session( oldSession.name || t( "sessions.default_name" ) );
      session.notes = oldSession.note || "";
      session.count = counts[ oldSession.id ] != null ? counts[ oldSession.id ] : 1;
      session.steps = [];
      // The old planner put a break between two runs that ended up next to
      // each other (and nowhere else), as auto_break_minutes does here.
      session.auto_break_minutes = oldSession.autoBreak !== false ? Math.max( 0 , Number( oldSession.breakMinutes ) || 0 ) : 0;
      let guessed = false;
      ( oldSession.blocks || [] ).filter( ( b ) => b.enabled !== false ).forEach( ( block ) => {
        const times = Math.max( 1 , Number( block.count ) || 1 );
        for ( let k = 0; k < times; k += 1 ) {
          if ( block.kind === "run" ) {
            session.steps.push( Schema.step( "run" , runIds[ block.run ] || "" ) );
            continue;
          }
          if ( block.kind === "structural" ) {
            const card = cardFor( block.protocol );
            const step = Object.assign( Schema.step( "scan" ) , { name: block.protocol || block.label || "" , minutes: Number( block.minutes ) || 5 } );
            if ( card ) {
              step.card = Scanners.ref( card );
              step.name = card.label;
              if ( step.card.seconds > 0 ) step.minutes = Math.round( step.card.seconds / 60 * 100 ) / 100;
            } else {
              if ( block.protocol ) missingCards.add( block.protocol );
              guessed = true;
            }
            session.steps.push( step );
          } else {
            session.steps.push( Object.assign( Schema.step( "break" ) , { name: block.label || "" , minutes: Number( block.minutes ) || 0 } ) );
          }
        }
      } );
      if ( guessed ) notes.push( t( "legacy.note_structural" ).replace( "{session}" , session.name ) );
      doc.sessions.push( session );
    } );

    if ( missingCards.size ) notes.push( t( "legacy.note_cards" ).replace( "{cards}" , Array.from( missingCards ).join( ", " ) ) );
    if ( old.caps ) notes.push( t( "legacy.note_caps" ) );
    if ( old.dynScansFrom ) notes.push( t( "legacy.note_dyn" ) );
    if ( budget.solveMode && budget.solveMode !== "manual" ) notes.push( t( "legacy.note_solver" ).replace( "{mode}" , budget.solveMode ) );
    // The response shape carries over; the objectives and solvers do not.
    if ( old.hrf ) {
      const map = { peakDelay: "peak_delay" , peakDispersion: "peak_dispersion" , undershootDelay: "undershoot_delay" , undershootDispersion: "undershoot_dispersion" , undershootRatio: "undershoot_ratio" , spanSeconds: "span" };
      doc.hrf = Object.assign( {} , Schema.HRF_DEFAULTS );
      Object.keys( map ).forEach( ( k ) => { if ( Number.isFinite( Number( old.hrf[ k ] ) ) ) doc.hrf[ map[ k ] ] = Number( old.hrf[ k ] ); } );
      if ( old.hrf.objectives ) notes.push( t( "legacy.note_hrf" ) );
    }
    if ( budget.contingencyPct ) notes.push( t( "legacy.note_contingency" ).replace( "{pct}" , budget.contingencyPct ) );
    return { doc: Schema.normalise( doc ) , notes: notes };
  },

  // -- the question bank ------------------------------------------------------

  async importBank( data , name ) {
    const t = ( key ) => I18n.get( key );
    const items = Array.isArray( data ) ? data : data.questions;
    const doc = Doc.doc;
    let list = doc.lists.find( ( l ) => l.name === t( "legacy.questions_list" ) && l.items.length === 0 ) || null;
    const listId = list ? list.id : Schema.uid( "list" );
    const columns = [
      Schema.column( "Text" , "text" ), Schema.column( "Image" , "image" , [ "text" ] ),
      Schema.column( "Answer" , "text" , [ "text" , "image" ] ), Schema.column( "Category" , "text" , [ "text" , "image" , "answer" ] ),
      Schema.column( "Family" , "text" , [ "text" , "image" , "answer" , "category" ] ),
      Schema.column( "Title" , "text" , [ "text" , "image" , "answer" , "category" , "family" ] ),
    ];
    // Shapes questions become pictures, uploaded once each.
    const pictures = {};
    let drawn = 0;
    for ( const q of items ) {
      if ( q.view === "shapes" && q.params && Array.isArray( q.params.shapes ) ) {
        const blob = await this.drawShapes( q.params.shapes , doc.display.aspect );
        const file = new File( [ blob ] , ( q.family || "shapes" ) + "-" + String( q.uuid || drawn ).slice( 0 , 8 ) + ".png" , { type: "image/png" } );
        const ids = await MediaLibrary.upload( [ file ] );
        if ( ids.length ) pictures[ q.uuid ] = ids[ 0 ];
        drawn += 1;
      }
    }
    let skippedImages = 0;
    const rows = items.map( ( q ) => {
      if ( q.view === "image" ) skippedImages += 1;
      const picture = pictures[ q.uuid ] || "";
      return Schema.item( {
        text: picture ? "" : q.text || "" , title: picture ? q.text || "" : "" , image: picture ,
        answer: q.answer == null ? "" : String( q.answer ),
        category: q.category || "" , family: q.family || "",
      } );
    } );
    Doc.change( t( "undo.items_imported" ) , ( d ) => {
      let target = d.lists.find( ( l ) => l.id === listId );
      if ( !target ) {
        target = Schema.list( name || t( "legacy.questions_list" ) );
        target.id = listId;
        d.lists.push( target );
      }
      target.columns = columns;
      target.items = rows;
      // Trial types already pointing at this list keep working; one that
      // draws from no list yet and shows {text} is pointed at it.
      d.trial_types.forEach( ( tt ) => {
        if ( !tt.list && tt.phases.some( ( p ) => p.layers.some( ( l ) => l.kind === "text" && l.text.includes( "{text}" ) ) ) ) tt.list = listId;
        if ( tt.list !== listId || !drawn ) return;
        tt.phases.forEach( ( phase ) => {
          const text = phase.layers.find( ( l ) => l.kind === "text" && l.text === "{text}" );
          if ( text && !phase.layers.some( ( l ) => l.kind === "text" && l.text.includes( "{title}" ) ) ) {
            phase.layers.push( Object.assign( Schema.textLayer( "{title}" , text.height ) , { pos: [ 0 , 0.3 ] } ) );
          }
        } );
      } );
    } , { toast: true } );
    Prompts.focus( listId );
    let report = t( "legacy.bank_imported" ).replace( "{count}" , rows.length ).replace( "{drawn}" , drawn );
    if ( skippedImages ) report += " " + t( "legacy.bank_images_skipped" ).replace( "{count}" , skippedImages );
    return report;
  },

  // The old task's shapes, drawn where it drew them: a transparent picture of
  // the whole screen, in height units, so pos and size carry over exactly.
  drawShapes( shapes , aspect ) {
    const height = 800;
    const width = Math.round( height * ( aspect || 1.6 ) );
    const canvas = document.createElement( "canvas" );
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext( "2d" );
    const edges = { triangle: 3 , square: 4 , diamond: 4 , pentagon: 5 , hexagon: 6 , circle: 64 };
    shapes.slice( 0 , 6 ).forEach( ( shape ) => {
      const radius = ( Number( shape.size ) || 0.08 ) * height;
      const cx = width / 2 + ( shape.pos ? shape.pos[ 0 ] : 0 ) * height;
      const cy = height / 2 - ( shape.pos ? shape.pos[ 1 ] : 0 ) * height;
      const n = edges[ shape.kind ] || 4;
      const ori = ( ( shape.ori != null ? shape.ori : shape.kind === "square" ? 45 : 0 ) * Math.PI ) / 180;
      ctx.fillStyle = typeof shape.color === "string" ? shape.color : "white";
      ctx.beginPath();
      for ( let e = 0; e < n; e += 1 ) {
        const a = ( e * Math.PI * 2 ) / n + ori;
        const x = cx + Math.sin( a ) * radius;
        const y = cy - Math.cos( a ) * radius;
        if ( e === 0 ) ctx.moveTo( x , y ); else ctx.lineTo( x , y );
      }
      ctx.closePath();
      ctx.fill();
    } );
    return new Promise( ( resolve ) => canvas.toBlob( resolve , "image/png" ) );
  },
};
