/* Jeeves durable workspace modules. All records are scoped by Supabase RLS. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const esc = (value) => String(value ?? "");
  const dateText = (value) => value ? new Date(value).toLocaleDateString("en-GB") : "No date";
  const money = (value, currency="GBP") => new Intl.NumberFormat("en-GB",{style:"currency",currency}).format(Number(value)||0);
  let currentTab = "projects";
  const config = {
    projects: {table:"jeeves_projects",title:"Projects",description:"Create projects, track status and keep the next step visible."},
    ideas: {table:"jeeves_ideas",title:"Ideas & planning",description:"Capture ideas, review them and decide what deserves commitment."},
    finance: {table:"jeeves_financial_entries",title:"Financials",description:"Record real income and spending. Jeeves never invents balances."},
    fitness: {table:"jeeves_fitness_logs",title:"Fitness tracker",description:"Keep your own meal, training, measurement and habit logs alongside connected health data."},
    documents: {table:"jeeves_documents",title:"Documents & drafts",description:"Save notes and drafts privately so they can be retrieved and edited."},
    brain: {table:"knowledge_items",title:"Jeeves Brain",description:"Build a searchable personal knowledge base and connect related ideas."}
  };
  function node(tag, text, cls) {
    const el=document.createElement(tag);
    if(text!==undefined) el.textContent=text;
    if(cls) el.className=cls;
    return el;
  }
  function field(labelText, name, type="text", required=true) {
    const wrap=node("label",undefined,"jw-field");
    wrap.append(node("span",labelText));
    const input=type==="textarea"?node("textarea"):node("input");
    if(type!=="textarea") input.type=type;
    input.name=name; input.required=required;
    if(type==="textarea") input.rows=3;
    wrap.append(input);
    return wrap;
  }
  function selectField(labelText,name,choices) {
    const wrap=node("label",undefined,"jw-field");
    wrap.append(node("span",labelText));
    const select=node("select"); select.name=name;
    choices.forEach(([value,label])=>{const o=node("option",label);o.value=value;select.append(o);});
    wrap.append(select);return wrap;
  }
  function formFor(fields, submitText, onSubmit) {
    const form=node("form",undefined,"jw-form");
    fields.forEach(f=>form.append(f));
    const submit=node("button",submitText,"action-primary");submit.type="submit";form.append(submit);
    form.addEventListener("submit",async e=>{e.preventDefault();submit.disabled=true;try{const data=Object.fromEntries(new FormData(form).entries());await onSubmit(data);form.reset();}catch(err){status(form.parentElement,err.message||"Could not save record.");}finally{submit.disabled=false;}});
    return form;
  }
  function status(host,message) {
    let el=host.querySelector(".jw-status");
    if(!el){el=node("p",undefined,"jw-status");el.setAttribute("role","status");host.prepend(el);}
    el.textContent=message;
  }
  async function signedIn() {
    const {data,error}=await db.auth.getSession();
    if(error) throw error;
    if(!data.session) throw new Error("Sign in to access your private Jeeves workspace.");
  }
  async function rows(table, columns="*") {
    await signedIn();
    const {data,error}=await db.from(table).select(columns).order(table==="jeeves_fitness_logs"?"logged_at":table==="jeeves_financial_entries"?"occurred_on":"updated_at",{ascending:false}).limit(200);
    if(error) throw error;
    return data||[];
  }
  async function insert(table,payload) {
    await signedIn();
    const {error}=await db.from(table).insert(payload);
    if(error) throw error;
  }
  async function update(table,id,payload) {
    await signedIn();
    const {error}=await db.from(table).update(payload).eq("id",id);
    if(error) throw error;
  }
  async function remove(table,id) {
    await signedIn();
    const {error}=await db.from(table).delete().eq("id",id);
    if(error) throw error;
  }
  function shell(host,title,description) {
    host.replaceChildren();
    const head=node("div",undefined,"jw-head");
    head.append(node("h2",title),node("p",description));
    const content=node("div",undefined,"jw-content");
    host.append(head,content);
    return content;
  }
  function action(label,handler,cls="jw-action") {
    const b=node("button",label,cls);b.type="button";b.addEventListener("click",handler);return b;
  }
  function card(title,detail,meta) {
    const el=node("article",undefined,"jw-card");
    el.append(node("h3",title),node("p",detail));
    if(meta) el.append(node("small",meta));
    return el;
  }
  function renderList(host,items,renderItem,empty) {
    const list=node("div",undefined,"jw-list");
    if(!items.length) list.append(node("p",empty,"jw-empty"));
    else items.forEach(item=>list.append(renderItem(item)));
    host.append(list);
  }
  async function renderProjects(host) {
    const content=shell(host,"Projects hub",config.projects.description);
    const form=formFor([field("Project name","name"),field("Description","description","textarea",false),selectField("Status","status",[["active","Active"],["on_hold","On hold"],["completed","Completed"]]),field("Target date","due_at","date",false)],"Create project",async d=>{
      await insert("jeeves_projects",{name:d.name.trim(),description:d.description,status:d.status,due_at:d.due_at||null});await renderProjects(host);
    });
    content.append(form);
    try {
      const data=await rows("jeeves_projects");
      const milestoneResult=await db.from("jeeves_project_milestones").select("id,project_id,title,status,due_at").order("due_at",{ascending:true});
      if(milestoneResult.error)throw milestoneResult.error;
      const milestones=milestoneResult.data||[];
      renderList(content,data,item=>{
        const el=card(item.name,item.description||"No description",item.status+" · "+(item.due_at?dateText(item.due_at):"No target date"));
        const projectMilestones=milestones.filter(m=>m.project_id===item.id);
        const milestoneWrap=node("div",undefined,"jw-milestones");
        milestoneWrap.append(node("strong","Milestones ("+projectMilestones.length+")"));
        projectMilestones.forEach(m=>{
          const row=node("div",undefined,"jw-actions");
          const toggle=action(m.status==="completed"?"✓ "+m.title:m.title,async()=>{try{await update("jeeves_project_milestones",m.id,{status:m.status==="completed"?"pending":"completed"});await renderProjects(host);}catch(e){status(content,e.message);}});
          row.append(toggle,node("small",m.due_at?dateText(m.due_at):"No due date"));
          row.append(action("×",async()=>{if(!confirm("Delete this milestone?"))return;try{await remove("jeeves_project_milestones",m.id);await renderProjects(host);}catch(e){status(content,e.message);}}));
          milestoneWrap.append(row);
        });
        const milestoneForm=node("form",undefined,"jw-form");
        const milestoneInput=node("input");milestoneInput.name="title";milestoneInput.required=true;milestoneInput.placeholder="New milestone";milestoneInput.setAttribute("aria-label","New milestone title");
        const milestoneDate=node("input");milestoneDate.type="date";milestoneDate.name="due_at";milestoneDate.setAttribute("aria-label","Milestone due date");
        const milestoneButton=node("button","Add milestone","jw-action");milestoneButton.type="submit";
        milestoneForm.append(milestoneInput,milestoneDate,milestoneButton);
        milestoneForm.addEventListener("submit",async e=>{e.preventDefault();milestoneButton.disabled=true;try{await insert("jeeves_project_milestones",{project_id:item.id,title:milestoneInput.value.trim(),due_at:milestoneDate.value||null});await renderProjects(host);}catch(err){status(content,err.message);milestoneButton.disabled=false;}});
        el.append(milestoneWrap,milestoneForm);
        const controls=node("div",undefined,"jw-actions");
        controls.append(action("Change status",async()=>{const next=prompt("Status: active, on_hold, completed or archived",item.status);if(!next||!["active","on_hold","completed","archived"].includes(next))return;try{await update("jeeves_projects",item.id,{status:next,updated_at:new Date().toISOString()});await renderProjects(host);}catch(e){status(content,e.message);}}));
        controls.append(action("Edit details",async()=>{const name=prompt("Project name",item.name);if(name===null||!name.trim())return;const description=prompt("Description",item.description||"");if(description===null)return;try{await update("jeeves_projects",item.id,{name:name.trim(),description,updated_at:new Date().toISOString()});await renderProjects(host);}catch(e){status(content,e.message);}}));
        controls.append(action("Delete",async()=>{if(!confirm("Permanently delete this project?"))return;try{await remove("jeeves_projects",item.id);await renderProjects(host);}catch(e){status(content,e.message);}}));
        el.append(controls);return el;
      },"No projects yet. Create your first project above.");
    }catch(e){status(content,e.message);}
  }
  async function renderIdeas(host) {
    const content=shell(host,"Ideas & planning",config.ideas.description);
    content.append(formFor([field("Idea title","title"),field("Idea details","content","textarea",false)],"Save idea",async d=>{await insert("jeeves_ideas",{title:d.title.trim(),content:d.content});await renderIdeas(host);}));
    try{
      const data=await rows("jeeves_ideas");
      renderList(content,data,item=>{
        const el=card(item.title,item.content||"No details",item.status+" · "+dateText(item.created_at));
        const controls=node("div",undefined,"jw-actions");
        controls.append(selectField("Decision","status",[["captured","Captured"],["considering","Considering"],["approved","Approved"],["parked","Parked"],["rejected","Rejected"]]));
        const select=controls.querySelector("select");select.value=item.status;
        select.addEventListener("change",async()=>{try{await update("jeeves_ideas",item.id,{status:select.value,updated_at:new Date().toISOString()});status(content,"Idea status saved.");}catch(e){status(content,e.message);}});
        controls.append(action("Ask Jeeves to assess",()=>{quickPrompt("Assess this saved idea. Evaluate value, effort, risks and next step. Do not create tasks without my approval.\n\n"+item.title+"\n"+item.content);switchTab("command");}));
        controls.append(action("Delete",async()=>{if(!confirm("Delete this idea?"))return;try{await remove("jeeves_ideas",item.id);await renderIdeas(host);}catch(e){status(content,e.message);}}));
        el.append(controls);return el;
      },"No ideas saved yet.");
    }catch(e){status(content,e.message);}
  }
  async function renderFinance(host) {
    const content=shell(host,"Financials",config.finance.description);
    const totals=node("div",undefined,"jw-metrics");
    content.append(totals);
    content.append(formFor([selectField("Entry type","entry_type",[["expense","Expense"],["income","Income"]]),field("Amount (£)","amount","number"),field("Category","category"),field("Description","description","text",false),field("Date","occurred_on","date")],"Save transaction",async d=>{
      const amount=Number(d.amount);if(!Number.isFinite(amount)||amount<=0)throw new Error("Enter a positive amount.");
      await insert("jeeves_financial_entries",{entry_type:d.entry_type,amount,currency:"GBP",category:d.category.trim()||"General",description:d.description,occurred_on:d.occurred_on||new Date().toISOString().slice(0,10)});await renderFinance(host);
    }));
    content.append(node("h3","Budget targets"));
    content.append(formFor([field("Budget name","name"),field("Amount (£)","amount","number"),field("Category","category"),selectField("Period","period",[["weekly","Weekly"],["monthly","Monthly"],["yearly","Yearly"]])],"Save budget",async d=>{
      const amount=Number(d.amount);if(!Number.isFinite(amount)||amount<=0)throw new Error("Enter a positive budget amount.");
      await insert("jeeves_budgets",{name:d.name.trim(),amount,currency:"GBP",category:d.category.trim()||"Overall",period:d.period});await renderFinance(host);
    }));
    try {
      const budgets=await rows("jeeves_budgets","id,name,amount,currency,category,period");
      renderList(content,budgets,item=>{
        const el=card(item.name,money(item.amount,item.currency)+" · "+item.period,item.category);
        el.append(action("Delete budget",async()=>{if(!confirm("Delete this budget target?"))return;try{await remove("jeeves_budgets",item.id);await renderFinance(host);}catch(e){status(content,e.message);}}));return el;
      },"No budgets saved yet.");
    } catch(e) { status(content,e.message); }
    content.append(node("h3","Recent transactions"));
    try{
      const data=await rows("jeeves_financial_entries","id,entry_type,amount,currency,category,description,occurred_on");
      const income=data.filter(x=>x.entry_type==="income").reduce((s,x)=>s+Number(x.amount),0);
      const expense=data.filter(x=>x.entry_type==="expense").reduce((s,x)=>s+Number(x.amount),0);
      totals.append(card("Income",money(income),"Recent 200 saved entries"),card("Spending",money(expense),"Recent 200 saved entries"),card("Net",money(income-expense),"Income minus spending"));
      renderList(content,data,item=>{
        const el=card((item.entry_type==="income"?"+ ":"− ")+money(item.amount,item.currency),item.description||item.category,item.category+" · "+dateText(item.occurred_on));
        el.append(action("Edit",async()=>{const amount=prompt("Amount",String(item.amount));if(amount===null)return;const numeric=Number(amount);if(!Number.isFinite(numeric)||numeric<=0){status(content,"Enter a positive amount.");return;}const description=prompt("Description",item.description||"");if(description===null)return;try{await update("jeeves_financial_entries",item.id,{amount:numeric,description});await renderFinance(host);}catch(e){status(content,e.message);}}));
        el.append(action("Delete transaction",async()=>{if(!confirm("Delete this financial entry?"))return;try{await remove("jeeves_financial_entries",item.id);await renderFinance(host);}catch(e){status(content,e.message);}}));
        return el;
      },"No transactions recorded. Add one above to start tracking actual figures.");
    }catch(e){status(content,e.message);}
    content.append(node("p","Figures shown are based only on records entered here. No bank balances or transactions are inferred.","jw-disclaimer"));
  }
  async function renderFitness(host) {
    const content=shell(host,"Fitness tracker",config.fitness.description);
    content.append(formFor([selectField("Log type","log_type",[["meal","Meal"],["workout","Workout"],["measurement","Body measurement"],["habit","Habit"]]),field("Title","title"),field("Details","details","textarea",false),field("Quantity (optional)","quantity","number",false),field("Unit (optional)","unit","text",false)],"Save fitness log",async d=>{
      const payload={log_type:d.log_type,title:d.title.trim(),details:d.details,unit:d.unit||null,logged_at:new Date().toISOString()};
      if(d.quantity!==""){const q=Number(d.quantity);if(!Number.isFinite(q)||q<0)throw new Error("Quantity must be zero or higher.");payload.quantity=q;}
      await insert("jeeves_fitness_logs",payload);await renderFitness(host);
    }));
    try{
      const data=await rows("jeeves_fitness_logs","id,log_type,title,details,quantity,unit,logged_at");
      renderList(content,data,item=>{
        const detail=[item.details,item.quantity!==null&&item.quantity!==undefined?item.quantity+" "+(item.unit||""):""].filter(Boolean).join(" · ");
        const el=card(item.title,detail||"No details",item.log_type+" · "+new Date(item.logged_at).toLocaleString("en-GB"));
        el.append(action("Edit",async()=>{const title=prompt("Log title",item.title);if(title===null||!title.trim())return;const details=prompt("Details",item.details||"");if(details===null)return;try{await update("jeeves_fitness_logs",item.id,{title:title.trim(),details});await renderFitness(host);}catch(e){status(content,e.message);}}));
        el.append(action("Delete log",async()=>{if(!confirm("Delete this fitness log?"))return;try{await remove("jeeves_fitness_logs",item.id);await renderFitness(host);}catch(e){status(content,e.message);}}));return el;
      },"No fitness logs yet. Start with a meal, workout, measurement or habit.");
    }catch(e){status(content,e.message);}
  }
  async function renderDocuments(host) {
    const content=shell(host,"Documents & drafts",config.documents.description);
    content.append(formFor([field("Document title","title"),selectField("Type","document_type",[["note","Note"],["draft","Draft"],["letter","Letter"],["plan","Plan"],["checklist","Checklist"]]),field("Content","content","textarea")],"Save document",async d=>{
      await insert("jeeves_documents",{title:d.title.trim(),document_type:d.document_type,content:d.content});await renderDocuments(host);
    }));
    try{
      const data=await rows("jeeves_documents","id,title,content,document_type,created_at,updated_at");
      renderList(content,data,item=>{
        const el=card(item.title,item.content,item.document_type+" · Updated "+dateText(item.updated_at));
        el.append(action("Edit",async()=>{const title=prompt("Document title",item.title);if(title===null||!title.trim())return;const body=prompt("Document content",item.content);if(body===null)return;try{await update("jeeves_documents",item.id,{title:title.trim(),content:body,updated_at:new Date().toISOString()});await renderDocuments(host);}catch(e){status(content,e.message);}}));
        el.append(action("Delete",async()=>{if(!confirm("Permanently delete this document?"))return;try{await remove("jeeves_documents",item.id);await renderDocuments(host);}catch(e){status(content,e.message);}}));return el;
      },"No saved documents yet.");
    }catch(e){status(content,e.message);}
  }
  async function renderBrain(host) {
    const content=shell(host,"Jeeves Brain",config.brain.description);
    const search=node("input");search.type="search";search.placeholder="Search your knowledge…";search.setAttribute("aria-label","Search knowledge");content.append(search);
    content.append(formFor([field("Title","title"),selectField("Category","category",[["general","General"],["personal","Personal"],["work","Work"],["project","Project"],["reference","Reference"]]),field("Knowledge / note","content","textarea"),field("Tags (comma separated)","tags","text",false)],"Save to Brain",async d=>{
      const tags=d.tags.split(",").map(x=>x.trim()).filter(Boolean).slice(0,20);
      await insert("knowledge_items",{title:d.title.trim(),category:d.category,content:d.content,tags,source:"user",consent_status:"approved",confidence:1});
      await renderBrain(host);
    }));
    const listHost=node("div");content.append(listHost);
    async function load(){
      try{
        await signedIn();
        const {data,error}=await db.from("knowledge_items").select("id,title,content,category,tags,created_at").is("archived_at",null).order("updated_at",{ascending:false}).limit(200);
        if(error)throw error;
        const term=search.value.trim().toLowerCase();
        const filtered=(data||[]).filter(x=>!term||(x.title+" "+x.content+" "+(x.tags||[]).join(" ")).toLowerCase().includes(term));
        listHost.replaceChildren();
        if(data.length>1){
          const linkForm=node("form",undefined,"jw-form");
          const from=node("label",undefined,"jw-field");from.append(node("span","Link from"));
          const fromSelect=node("select");fromSelect.name="from_item_id";
          const to=node("label",undefined,"jw-field");to.append(node("span","Link to"));
          const toSelect=node("select");toSelect.name="to_item_id";
          data.forEach(item=>{const a=node("option",item.title);a.value=item.id;fromSelect.append(a);const b=node("option",item.title);b.value=item.id;toSelect.append(b);});
          const relation=node("label",undefined,"jw-field");relation.append(node("span","Relationship"));
          const relInput=node("input");relInput.name="relation";relInput.value="related";relInput.required=true;relation.append(relInput);
          const linkButton=node("button","Create link","action-primary");linkButton.type="submit";
          linkForm.append(from, to, relation, linkButton);
          linkForm.addEventListener("submit",async e=>{e.preventDefault();if(fromSelect.value===toSelect.value){status(content,"Choose two different knowledge items.");return;}linkButton.disabled=true;try{await insert("knowledge_links",{from_item_id:fromSelect.value,to_item_id:toSelect.value,relation:relInput.value.trim().slice(0,80)});status(content,"Knowledge link saved.");}catch(err){status(content,err.message);}finally{linkButton.disabled=false;}});
          from.append(fromSelect);to.append(toSelect);listHost.append(linkForm);
          try{
            const {data:links,error:linkError}=await db.from("knowledge_links").select("id,from_item_id,to_item_id,relation").order("created_at",{ascending:false}).limit(100);
            if(linkError)throw linkError;
            const own=(links||[]).filter(link=>data.some(x=>x.id===link.from_item_id)&&data.some(x=>x.id===link.to_item_id));
            own.forEach(link=>{const row=node("div",undefined,"jw-actions");row.append(node("span",data.find(x=>x.id===link.from_item_id).title+" — "+link.relation+" → "+data.find(x=>x.id===link.to_item_id).title));row.append(action("Remove link",async()=>{try{await remove("knowledge_links",link.id);await load();}catch(err){status(content,err.message);}}));listHost.append(row);});
          }catch(err){status(content,err.message);}
        }
        renderList(listHost,filtered,item=>{
          const el=card(item.title,item.content,item.category+" · "+(item.tags||[]).join(", "));
          el.append(action("Edit",async()=>{const title=prompt("Knowledge title",item.title);if(title===null||!title.trim())return;const body=prompt("Knowledge content",item.content);if(body===null)return;try{await update("knowledge_items",item.id,{title:title.trim(),content:body});await load();}catch(e){status(content,e.message);}}));
          el.append(action("Archive",async()=>{try{await update("knowledge_items",item.id,{archived_at:new Date().toISOString()});await load();}catch(e){status(content,e.message);}}));
          el.append(action("Delete",async()=>{if(!confirm("Permanently delete this knowledge item?"))return;try{await remove("knowledge_items",item.id);await load();}catch(e){status(content,e.message);}}));
          return el;
        },"Your Brain is empty. Save your first knowledge item above.");
      }catch(e){status(content,e.message);}
    }
    search.addEventListener("input",load);await load();
  }
  function mountCouncilPrefs() {
    const toggles=Array.from(document.querySelectorAll(".council-toggle"));
    try {
      const saved=JSON.parse(localStorage.getItem("jeeves-council-advisers")||"null");
      if(saved&&typeof saved==="object")toggles.forEach(input=>{if(typeof saved[input.dataset.adviser]==="boolean")input.checked=saved[input.dataset.adviser];});
    } catch(e) {}
    toggles.forEach(input=>input.addEventListener("change",()=>{
      const state={};toggles.forEach(item=>state[item.dataset.adviser]=item.checked);
      try{localStorage.setItem("jeeves-council-advisers",JSON.stringify(state));}catch(e){}
    }));
  }
  function mountNav() {
    const nav=document.querySelector('[aria-label="Knowledge and system tools"]');
    if(!nav)return;
    const add=(id,label,tab)=>{if($(id))return;const b=node("button",label,"nav-btn");b.id=id;b.type="button";b.addEventListener("click",()=>{switchTab(tab);toggleMobileSidebar(false);});nav.append(b);};
    add("nav-brain","Jeeves Brain","brain");
    add("nav-documents","Documents & drafts","documents");
  }
  function mountViews() {
    const project=$("view-projects"),finance=$("view-financial"),fitness=$("view-fitness"),drafts=$("view-drafts");
    if(project)renderProjects(project);
    if(finance)renderFinance(finance);
    if(fitness){const panel=node("section",undefined,"jw-extra-panel");panel.id="fitness-tracking-panel";fitness.append(panel);renderFitness(panel);}
    if(drafts)renderDocuments(drafts);
    const main=document.querySelector("main.main-area");
    let brain=$("view-brain");if(!brain){brain=node("section",undefined,"view-section dedicated-page");brain.id="view-brain";brain.hidden=true;main.append(brain);}
    let ideas=$("view-ideas");if(!ideas){ideas=node("section",undefined,"view-section dedicated-page");ideas.id="view-ideas";ideas.hidden=true;main.append(ideas);}
    renderBrain(brain);
    renderIdeas(ideas);
  }
  window.refreshJeevesWorkspaces=()=>mountViews();
  document.addEventListener("DOMContentLoaded",()=>{mountNav();mountCouncilPrefs();mountViews();});
  if(typeof db!=="undefined"&&db.auth)db.auth.onAuthStateChange((event)=>{if(["SIGNED_IN","SIGNED_OUT","TOKEN_REFRESHED"].includes(event))setTimeout(mountViews,150);});
})();