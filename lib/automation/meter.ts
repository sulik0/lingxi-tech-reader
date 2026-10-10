import {readLimited} from './feeds.ts';
import type {AutomationStore} from './store.ts';
/** Record provider counts only; missing usage remains unknown rather than zero. */
export function meteredFetch(fetcher:typeof fetch,store:AutomationStore,stage:string):typeof fetch {
  return async(input,init)=>{
    let model='未返回',response:Response|undefined,prompt:number|null=null,completion:number|null=null;
    try {
      if(typeof init?.body==='string'){try{const body=JSON.parse(init.body);if(typeof body.model==='string')model=body.model.slice(0,100);}catch{}}
      response=await fetcher(input,init);
      try{const raw=await readLimited(response.clone(),180000);if(raw.length<=180000){const data=JSON.parse(raw),usage=data.usage;if(typeof data.model==='string')model=data.model.slice(0,100);const valid=(n:unknown)=>typeof n==='number'&&Number.isSafeInteger(n)&&n>=0;
        const inputCount=usage?.prompt_tokens??usage?.input_tokens,outputCount=usage?.completion_tokens??usage?.output_tokens;
        if(valid(inputCount)&&valid(outputCount)){prompt=inputCount;completion=outputCount;}
      }}catch{}
      return response;
    }finally{
      // Logging must not cause an otherwise successful request to be repeated.
      await store.recordUsage(stage,model,prompt,completion).catch(()=>{});
    }
  };
}
