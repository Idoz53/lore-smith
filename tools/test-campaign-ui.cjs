const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const repo=path.resolve(__dirname,'..'),output=process.env.LORE_SMITH_QA_OUTPUT||require('node:os').tmpdir();
(async()=>{
  const browser=await chromium.launch({headless:true,channel:'msedge'});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('http://planner.test/**',route=>{
      const url=new URL(route.request().url());
      if(url.pathname==='/')return route.fulfill({contentType:'text/html',body:'<div class="lore-smith lore-smith-app"><main class="ls-main"></main></div>'});
      const file=path.resolve(repo,'.'+url.pathname);
      if(!file.startsWith(repo+path.sep))return route.abort();
      return route.fulfill({contentType:'text/javascript',body:fs.readFileSync(file,'utf8')});
    });
    await page.goto('http://planner.test/');
    await page.addStyleTag({content:fs.readFileSync(path.join(repo,'styles/lore-smith.css'),'utf8')+'\nbody{margin:0;background:#f5e5c2}.ls-main{overflow:visible;padding:20px}.lore-smith-app{min-width:0;grid-template-columns:1fr;height:auto}'});
    await page.evaluate(async()=>{
      window.notifications=[];window.confirmResult=true;
      window.ui={notifications:{error:m=>notifications.push(['error',m]),info:m=>notifications.push(['info',m])}};
      let count=0;window.foundry={utils:{randomID:()=>`browser-${++count}`},applications:{api:{DialogV2:{confirm:async options=>{window.lastConfirmation=options;window.confirmCount=(window.confirmCount||0)+1;return window.confirmResult;}}}}};
      const journals=new Map();window.game={journal:{get:id=>journals.get(id)}};
      window.JournalEntry={create:async data=>{
        const journal={...data,id:`journal-${journals.size+1}`,getFlag:(scope,key)=>data.flags?.[scope]?.[key],sheet:{render:()=>{window.openedJournal=journal.id;}},pages:data.pages.map((p,i)=>({...p,id:`page-${i}`,getFlag:(scope,key)=>p.flags?.[scope]?.[key]})),updateEmbeddedDocuments:async(_type,updates)=>{for(const u of updates)journal.pages.find(p=>p.id===u._id).text.content=u['text.content'];},createEmbeddedDocuments:async(_type,pages)=>journal.pages.push(...pages)};
        journals.set(journal.id,journal);window.createdJournal=journal;return journal;
      }};
      window.fromUuid=async uuid=>({uuid,name:'Linked map',documentName:uuid.startsWith('Scene.')?'Scene':'Actor',sheet:{render:()=>{window.openedDocument=uuid;}}});
      window.cw=await import('/scripts/campaign-workspace.js');
      window.app={campaign:{name:'La Stella del Tevrar',premise:'Stars move west and disappear',acts:[]},campaignWorkspaceState:{view:'overview',selectedId:''},element:document.querySelector('.lore-smith-app'),
        async saveCampaignDraft(){if(window.failDeleted&&[...this.campaign.workspace.situations,...this.campaign.workspace.sessions,...this.campaign.workspace.resources].some(r=>r.deletedAt))throw Error('Simulated deletion save failure');if(window.failComplete&&this.campaign.workspace.sessions.some(s=>s.status==='complete'))throw Error('Simulated save failure');window.savedCampaign=JSON.stringify(this.campaign);},
        async syncCampaignForm(){cw.syncCampaignWorkspace(this.campaign,this.element);await this.saveCampaignDraft();},
        async renderCampaignPreservingScroll(){this.element.querySelector('.ls-main').innerHTML=cw.renderCampaignWorkspace(this.campaign,this.campaignWorkspaceState);cw.bindCampaignWorkspace(this);cw.bindCampaignWorkspace(this);},
      };await app.renderCampaignPreservingScroll();
    });
    const action=a=>page.locator(`[data-pl-action="${a}"]`);
    const record=(type,id)=>page.locator(`[data-pl-record="${type}"][data-id="${id}"]`);
    const field=(label)=>page.getByLabel(label,{exact:true});
    async function fold(key){const d=page.locator(`[data-pl-fold="${key}"]`);if(!await d.evaluate(el=>el.open))await d.locator(':scope > summary').click();}
    async function view(key){await page.locator(`[data-pl-action=view][data-view="${key}"]`).click();}
    async function open(type,id){await view({adventure:'adventures',session:'sessions',person:'people'}[type]);await page.locator(`[data-pl-action=open][data-type="${type}"][data-id="${id}"]`).first().click();}
    await field('The party is at').fill('Cassardis');await field('They plan to').fill('Ask about the expedition');await field('Facts to remember').fill('Quina knows the fishermen');
    await action('new-adventure').click();await field('Adventure name').fill('La Stella del Tevrar');
    const a=await page.evaluate(()=>app.campaignWorkspaceState.selectedId);
    assert.equal(await page.evaluate(()=>app.campaign.workspace.situations.length),1);
    await field('The current problem').fill('A fallen star is changing the lake');await field('Why the party might become involved').fill('Quina asks for help');
    await fold(`who-${a}`);await action('add-participant').click();
    await field('Person or group').fill('Severin Vhal');await field('What they want').fill('Recover the star');await field('Resources they can use').fill('Boats, divers, equipment');
    await fold(`actions-${a}`);await action('add-action').click();
    await field('Name, if no shared entry').fill('Severin');await field('Intended action').fill('Send the divers into the lake');await field('Time or condition').fill('At dawn, if the crew is ready');
    const actionId=await page.evaluate(()=>app.campaign.workspace.actions[0].id);
    await action('add-visit').click();await field('Name of place or contact').fill('Tavern of the Old Aboleth');
    await field('What is happening there now').fill('Severin is recruiting divers');await field('What the NPCs want or what obstacle is present').fill('The captain wants reliable help');await field('What the party can investigate, learn, or attempt').fill('Negotiate, ask questions, or inspect equipment');
    const tavern=await page.evaluate(()=>app.campaign.workspace.situations[0].visitIds[0]);
    await record('resource',tavern).locator('[data-pl-drop]').dispatchEvent('drop',await page.evaluateHandle(()=>{const dt=new DataTransfer();dt.setData('text/plain',JSON.stringify({uuid:'Scene.tavern'}));return {dataTransfer:dt};}));
    await page.waitForFunction(()=>app.campaign.workspace.resources.some(r=>r.uuid==='Scene.tavern'));
    await fold(`discoveries-${a}`);await action('add-discovery').click();
    await field('What do the characters need to learn?').fill('The expedition is funded by the abbey');
    const clueIds=await page.evaluate(()=>app.campaign.workspace.revelations[0].clueIds);
    const discoveryId=await page.evaluate(()=>app.campaign.workspace.revelations[0].id);
    for(let i=0;i<3;i++){await record('resource',clueIds[i]).getByLabel('Clue',{exact:true}).fill(['A letter names the abbey','A witness saw the abbot pay','The ledger records the payment'][i]);await record('resource',clueIds[i]).getByLabel('Where the characters can find it',{exact:true}).fill('Quina');}
    await field('What have the players worked out so far?').fill('They suspect a wealthy patron');
    await page.waitForFunction(()=>document.querySelector('[data-pl-coverage]')?.textContent.includes('3 distinct clues with a source · 1 sources'));
    await record('resource',clueIds[0]).getByLabel('Where the characters can find it',{exact:true}).fill('Severin’s tent');
    await record('resource',clueIds[2]).getByLabel('Where the characters can find it',{exact:true}).fill('Abbey ledger');
    await fold(`material-${a}`);await action('add-material').click();await field('Material name').fill('Lake map and diving rules');await field('Notes or rules reference').fill('Map, depths, hazard statistics, and diving rules');
    const material=await page.evaluate(()=>app.campaign.workspace.situations[0].materialIds[0]);
    await record('resource',material).getByLabel('Foundry document (optional)',{exact:true}).fill('JournalEntry.diving');
    await action('new-person').click();await field('Person or Group name').fill('Quina');
    const person=await page.evaluate(()=>app.campaignWorkspaceState.selectedId);
    await field('Who they are').fill('A local guide');await field('Where to find them').fill('Cassardis tavern');await field('One detail that helps portray them').fill('Folds sailcloth while speaking');await field('What they want').fill('Find who paid for the expedition');await field('Resources they can use').fill('Fishing contacts and a boat');await field('What they know').fill('The western road reaches the abbey');await field('How they feel about the party, and why').fill('Trusts them because they helped Tomas');
    await open('adventure',a);
    await page.locator('[data-pl-record=participant] [data-pl-field=personId]').selectOption(person);
    assert.match(await page.locator('[data-pl-record=participant]').textContent(),/Trusts them because/);
    await action('new-adventure').click();await field('Adventure name').fill('The Silent Abbey');
    const secondAdventure=await page.evaluate(()=>app.campaignWorkspaceState.selectedId);
    await action('add-visit').click();await field('Name of place or contact').fill('The abbey gate');await field('What is happening there now').fill('The gates are closing');
    const abbey=await page.evaluate(()=>app.campaign.workspace.situations.find(a=>a.id===app.campaignWorkspaceState.selectedId).visitIds[0]);
    await open('adventure',a);await fold(`routes-${tavern}`);await action('add-route').click();await field('Leads to').selectOption(abbey);await field('How they can get there or learn about it').fill('Follow the western road from the tavern');await field('Use an existing clue (optional)').selectOption(clueIds[0]);
    assert.match(await page.locator('[data-pl-record=connection]').textContent(),/A letter names the abbey/);
    const counts=await page.evaluate(()=>[app.campaign.workspace.situations.length,app.campaign.workspace.resources.length,app.campaign.workspace.revelations.length]);
    await page.locator(`[data-pl-action=new-session][data-adventure="${a}"]`).click();
    const session=await page.evaluate(()=>app.campaignWorkspaceState.selectedId);
    assert.equal(await field('Linked Adventure').inputValue(),a);assert.equal(await field('Where are the characters now?').inputValue(),'Cassardis');
    assert.deepEqual(await page.evaluate(()=>[app.campaign.workspace.situations.length,app.campaign.workspace.resources.length,app.campaign.workspace.revelations.length]),counts);
    assert.equal(await page.locator(`[data-pl-select=visitIds][value="${abbey}"]`).count(),1,'Reachable destinations from another Adventure are available.');
    await page.locator(`[data-pl-select=visitIds][value="${tavern}"]`).check();
    await page.locator(`[data-pl-select=visitIds][value="${person}"]`).check();
    await fold(`session-actions-${session}`);await page.locator(`[data-pl-select=actionIds][value="${actionId}"]`).check();
    await fold(`session-ready-${session}`);await action('add-check').click();await field('Preparation item').fill('Read the diving rules');
    await page.locator(`[data-pl-select=materialIds][value="${material}"]`).check();await page.locator(`[data-pl-select=clueIds][value="${clueIds[0]}"]`).check();
    await field('Notes during the game').fill('The party negotiated with Severin and spoke to Quina.');
    await action('journal').click();await page.waitForFunction(()=>Boolean(window.createdJournal));
    assert.equal(await page.evaluate(()=>createdJournal.ownership.default),0);assert.match(await page.evaluate(()=>createdJournal.pages[0].text.content),/Scene.tavern/);
    await page.evaluate(()=>{createdJournal.pages[0].text.content='<p>Manual edits</p>';createdJournal.ownership.default=1;window.confirmResult=false;});
    await action('journal').click();await page.waitForFunction(()=>window.confirmCount>0);assert.equal(await page.evaluate(()=>createdJournal.pages[0].text.content),'<p>Manual edits</p>');assert.equal(await page.evaluate(()=>createdJournal.ownership.default),1);
    await page.evaluate(()=>{window.confirmResult=true;});await action('journal').click();await page.waitForFunction(()=>createdJournal.pages[0].text.content.includes('Scene.tavern'));
    await page.evaluate(async()=>{await app.syncCampaignForm();app.campaign=JSON.parse(savedCampaign);await app.renderCampaignPreservingScroll();});
    assert.equal(await field('Notes during the game').inputValue(),'The party negotiated with Severin and spoke to Quina.');
    await fold(`session-after-${session}`);await field('What happened and what changed?').fill('They found the letter and took the western road');await field('Which clues did they find, and what did they work out?').fill('They know the abbey paid for the expedition');
    await page.locator(`[data-pl-found][value="${clueIds[0]}"]`).check();await field('What have the players worked out so far?').fill('They know the patron but not the purpose');await field('Update this discovery when completing the Session').check();
    await field('What does the party intend to do next?').fill('Talk to the abbot');await field('Party location after the game').fill('The western road');await field('New facts to remember (optional)').fill('The abbey paid for the expedition');
    await page.evaluate(()=>{window.failComplete=true;});await action('complete-session').click();await page.waitForFunction(()=>notifications.some(([kind,text])=>kind==='error'&&text.includes('Simulated')));
    assert.equal(await page.evaluate(id=>app.campaign.workspace.sessions.find(s=>s.id===id).status,session),'planned');
    await page.evaluate(()=>{window.failComplete=false;window.notifications=[];});await action('complete-session').click();await page.waitForFunction(id=>app.campaign.workspace.sessions.find(s=>s.id===id).status==='complete',session);
    const saved=await page.evaluate(()=>JSON.parse(savedCampaign).workspace);
    assert.equal(saved.resources.find(r=>r.id===clueIds[0]).clueStatus,'delivered');assert.equal(saved.resources.find(r=>r.id===clueIds[1]).clueStatus,'prepared');assert.equal(saved.revelations[0].understanding,'They know the patron but not the purpose');assert.equal(saved.partyIntent,'Talk to the abbot');
    const frozen=saved.sessions.find(s=>s.id===session).snapshot.content;
    await open('adventure',a);await record('resource',tavern).getByLabel('What is happening there now',{exact:true}).fill('The expedition has left');
    await page.locator(`[data-pl-action=new-session][data-adventure="${a}"]`).click();
    const next=await page.evaluate(()=>app.campaignWorkspaceState.selectedId);
    assert.deepEqual(await page.evaluate(()=>[app.campaign.workspace.situations.length,app.campaign.workspace.resources.length,app.campaign.workspace.revelations.length]),counts);
    assert.equal(await field('Notes during the game').inputValue(),'');assert.match(await page.locator('.ls-cw-editor').textContent(),/The expedition has left/);
    assert.equal(await page.evaluate(id=>app.campaign.workspace.sessions.find(s=>s.id===id).snapshot.content,session),frozen);
    await open('session',session);await action('reopen-session').click();await field('Notes during the game').fill('Corrected game notes');
    assert.equal(await page.evaluate(id=>app.campaign.workspace.sessions.find(s=>s.id===id).versions.length,session),1);
    assert.equal(await field('Update Campaign Overview with this location, next intention, and new facts').isChecked(),false);
    await open('session',next);await page.screenshot({path:path.join(output,'campaign-entry-session.png'),fullPage:true});
    await view('overview');assert.equal(await field('They plan to').inputValue(),'Talk to the abbot');assert.match(await field('Facts to remember').inputValue(),/abbey paid/);
    await page.screenshot({path:path.join(output,'campaign-entry-overview.png'),fullPage:true});
    await page.setViewportSize({width:640,height:1000});await open('adventure',a);await page.screenshot({path:path.join(output,'campaign-entry-narrow.png'),fullPage:true});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1),'No horizontal overflow at 640px.');

    // Cancel, failed persistence, deletion, restoration, and shared references in the real UI.
    await page.setViewportSize({width:1280,height:1000});
    await page.evaluate(()=>{window.confirmResult=false;});
    await action('delete-entry').click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.match(await page.evaluate(()=>lastConfirmation.content),/Its Sessions, shared people/);
    assert.equal(await page.evaluate(id=>Boolean(app.campaign.workspace.situations.find(r=>r.id===id).deletedAt),a),false);
    await page.evaluate(()=>{window.confirmResult=true;window.failDeleted=true;});
    await action('delete-entry').click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await page.evaluate(id=>Boolean(app.campaign.workspace.situations.find(r=>r.id===id).deletedAt),a),false);
    assert.equal(await field('Adventure name').inputValue(),'La Stella del Tevrar');
    assert.ok(await page.evaluate(()=>notifications.some(([kind,text])=>kind==='error'&&text==='Simulated deletion save failure')));
    await page.evaluate(()=>{window.failDeleted=false;window.notifications=[];});
    await action('delete-entry').click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await page.locator(`[data-pl-action=open][data-type=adventure][data-id="${a}"]`).count(),0);
    assert.ok(await page.evaluate(id=>JSON.parse(savedCampaign).workspace.situations.find(r=>r.id===id).deletedAt,a));
    await open('session',next);assert.equal(await field('Linked Adventure').inputValue(),a);
    assert.match(await field('Linked Adventure').locator('option:checked').textContent(),/deleted/);
    assert.match(await page.locator('.ls-cw-editor').textContent(),/The expedition has left/);
    await page.evaluate(async()=>{await app.syncCampaignForm();app.campaign=JSON.parse(savedCampaign);await app.renderCampaignPreservingScroll();});
    assert.equal(await field('Linked Adventure').inputValue(),a);
    await fold('deleted-entries');
    await page.screenshot({path:path.join(output,'campaign-entry-delete.png'),fullPage:true});
    await page.locator(`[data-pl-action=restore-entry][data-type=adventure][data-id="${a}"]`).click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await field('Adventure name').inputValue(),'La Stella del Tevrar');
    assert.equal(await page.evaluate(id=>app.campaign.workspace.sessions.find(r=>r.id===id).adventureId,next),a);
    await open('person',person);await action('delete-entry').click();await page.evaluate(()=>app.campaignWorkspacePending);
    await open('adventure',a);await fold(`who-${a}`);
    assert.equal(await page.locator('[data-pl-record=participant] [data-pl-field=personId]').inputValue(),person);
    assert.match(await page.locator('[data-pl-record=participant]').textContent(),/Quina \(deleted\)/);
    await view('overview'); // Save the retained shared reference.
    assert.equal(await page.evaluate(id=>JSON.parse(savedCampaign).workspace.situations.find(r=>r.id===id).participants[0].personId,a),person);
    await fold('deleted-entries');await page.locator(`[data-pl-action=restore-entry][data-type=person][data-id="${person}"]`).click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await field('Person or Group name').inputValue(),'Quina');
    await open('session',session);await fold(`session-after-${session}`);await action('complete-session').click();await page.evaluate(()=>app.campaignWorkspacePending);
    const completedRecord=await page.evaluate(id=>JSON.stringify(app.campaign.workspace.sessions.find(r=>r.id===id)),session);
    const journalId=await page.evaluate(()=>createdJournal.id);
    await action('delete-entry').click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await page.locator(`[data-pl-action=open][data-type=session][data-id="${session}"]`).count(),0);
    assert.equal(await page.evaluate(id=>Boolean(game.journal.get(id)),journalId),true);
    await page.evaluate(async()=>{app.campaign=JSON.parse(savedCampaign);await app.renderCampaignPreservingScroll();});
    await fold('deleted-entries');await page.locator(`[data-pl-action=restore-entry][data-type=session][data-id="${session}"]`).click();await page.evaluate(()=>app.campaignWorkspacePending);
    assert.equal(await page.evaluate(id=>JSON.stringify(app.campaign.workspace.sessions.find(r=>r.id===id)),session),completedRecord);
    assert.equal(await action('reopen-session').count(),1);

    assert.deepEqual(errors,[]);assert.deepEqual(await page.evaluate(()=>notifications.filter(([kind])=>kind==='error')),[]);
    console.log('Browser campaign entries passed: immediate creation, editing, shared linking, reachable destinations, Foundry drops, Journal protection/permissions, save/reopen, failed completion retry, history revisions, reuse, narrow layout, and reversible entry deletion (cancel, failed save, links, and history).');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
