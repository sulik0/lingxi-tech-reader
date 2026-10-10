'use client';
import {Dialog} from 'radix-ui';
import {X} from 'lucide-react';
export default function FeedDialog({open,onOpenChange,title,description,children,returnFocus}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description:string;children:React.ReactNode;returnFocus:React.RefObject<HTMLElement|null>}){
 return <Dialog.Root open={open} onOpenChange={onOpenChange}><Dialog.Portal><Dialog.Overlay className="feed-overlay"/><Dialog.Content className="feed-modal" onCloseAutoFocus={e=>{e.preventDefault();if(returnFocus.current?.isConnected)returnFocus.current.focus();else document.getElementById('preference-input')?.focus();}}><div className="feed-modal-heading"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="feed-icon" aria-label="关闭弹窗"><X aria-hidden="true" size={20}/></Dialog.Close></div><div className="feed-modal-scroll"><Dialog.Description className="feed-help">{description}</Dialog.Description>{children}</div></Dialog.Content></Dialog.Portal></Dialog.Root>;
}
