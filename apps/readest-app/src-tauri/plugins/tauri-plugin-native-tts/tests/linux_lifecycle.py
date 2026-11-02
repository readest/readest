"""Device-free lifecycle regressions against the production handler and worker.

Run: python3 -I tests/linux_lifecycle.py
Uses rustc directly; no Cargo graph or audio device is required.
"""
import subprocess
import tempfile
from pathlib import Path

root = Path(__file__).resolve().parents[1] / "src"

def verify(name, source, directory):
    path = directory / (name + ".rs")
    path.write_text(source)
    binary = directory / name
    subprocess.run(["rustc", "--edition", "2021", "--test", str(path), "-o", str(binary)], check=True)
    subprocess.run([str(binary), "--nocapture"], check=True)

with tempfile.TemporaryDirectory(prefix="readest-lifecycle-") as temporary:
    directory = Path(temporary)
    src=(root/'commands.rs').read_text()
    start = src.index('pub(crate) fn playout_control')
    body = src[start:src.index('\n#[cfg(not(target_os = "linux"))]', start)]
    prefix=r'''
    #![allow(dead_code,unused_variables,unused_imports)]
    use std::sync::{Arc,Mutex,mpsc};
    use std::future::Future;
    use std::pin::Pin;
    use std::task::{Context,Poll,Wake,Waker};
    type Result<T>=std::result::Result<T,Error>;
    #[derive(Debug)] enum Error {NativeTTSError(String)}
    impl From<Error> for String{fn from(error:Error)->Self{format!("{error:?}")}}
    struct PlayoutControlRequest {action:String}
    struct PlayoutControlResponse;
    trait Runtime:Send+Sync+'static{}
    struct TestRuntime;impl Runtime for TestRuntime{}
    struct Native {log:Mutex<Vec<String>>}
    struct AppHandle<R>(Arc<Native>,std::marker::PhantomData<R>);
    impl<R> Clone for AppHandle<R>{fn clone(&self)->Self{Self(self.0.clone(),std::marker::PhantomData)}}
    trait NativeTtsExt {fn native_tts(&self)->&Native;}
    impl<R> NativeTtsExt for AppHandle<R>{fn native_tts(&self)->&Native{&self.0}}
    impl Native {
    fn playout_control(&self,request:PlayoutControlRequest)->Result<PlayoutControlResponse>{self.log.lock().unwrap().push(request.action);Ok(PlayoutControlResponse)}
    fn playout_control_enqueue(&self,request:PlayoutControlRequest)->Result<mpsc::Receiver<std::result::Result<PlayoutControlResponse,String>>>{
    self.log.lock().unwrap().push(request.action);let(s,r)=mpsc::channel();s.send(Ok(PlayoutControlResponse)).unwrap();Ok(r)
    }
    }
    mod tauri {
    pub trait Manager {}
    pub mod ipc {
    use super::super::*;
    pub struct Invoke<R>{pub message:Message<R>,pub resolver:Resolver,pub acl:()}
    pub struct Message<R>{pub app:AppHandle<R>,pub action:String}
    impl<R> Message<R>{pub fn webview(&self)->&Self{self}pub fn app_handle(&self)->&AppHandle<R>{&self.app}}
    pub struct CommandItem<'a,R>{pub plugin:Option<&'static str>,pub name:&'static str,pub key:&'static str,pub message:&'a Message<R>,pub acl:&'a ()}
    pub trait CommandArg<R>:Sized{fn from_command(item:CommandItem<'_,R>)->std::result::Result<Self,String>;}
    impl<R> CommandArg<R> for PlayoutControlRequest{fn from_command(item:CommandItem<'_,R>)->std::result::Result<Self,String>{Ok(Self{action:item.message.action.clone()})}}
    type Response=Pin<Box<dyn Future<Output=std::result::Result<PlayoutControlResponse,String>>+Send>>;
    static RESPONSES:Mutex<Vec<Response>>=Mutex::new(Vec::new());
    pub struct Resolver;
    impl Resolver{pub fn respond_async(self,f:impl Future<Output=std::result::Result<PlayoutControlResponse,String>>+Send+'static){RESPONSES.lock().unwrap().push(Box::pin(f));}pub fn invoke_error(self,e:String){panic!("{e}")}}
    pub fn execute_reverse(){
    struct Noop;impl Wake for Noop{fn wake(self:Arc<Self>){}}
    let w=Waker::from(Arc::new(Noop));let mut cx=Context::from_waker(&w);
    let mut responses=std::mem::take(&mut *RESPONSES.lock().unwrap());
    for response in responses.iter_mut().rev(){assert!(response.as_mut().poll(&mut cx).is_pending());}
    super::async_runtime::execute_reverse();
    for response in responses.iter_mut().rev(){assert!(matches!(response.as_mut().poll(&mut cx),Poll::Ready(Ok(_))));}
    }
    }
    pub mod async_runtime {
    use super::super::*;
    type Job=Box<dyn FnOnce()+Send>;
    static JOBS:Mutex<Vec<Job>>=Mutex::new(Vec::new());
    pub struct Join<T>(mpsc::Receiver<T>);
    impl<T> Future for Join<T>{type Output=std::result::Result<T,String>;fn poll(self:Pin<&mut Self>,_:&mut Context<'_>)->Poll<Self::Output>{match self.0.try_recv(){Ok(v)=>Poll::Ready(Ok(v)),Err(mpsc::TryRecvError::Empty)=>Poll::Pending,Err(e)=>Poll::Ready(Err(e.to_string()))}}}
    pub fn spawn_blocking<F,T>(f:F)->Join<T> where F:FnOnce()->T+Send+'static,T:Send+'static{let(s,r)=mpsc::channel();JOBS.lock().unwrap().push(Box::new(move||{let _=s.send(f());}));Join(r)}
    pub fn execute_reverse(){let mut jobs=std::mem::take(&mut *JOBS.lock().unwrap());while let Some(job)=jobs.pop(){job();}}
    }}
    '''
    test=r'''
    #[test] fn transport_is_enqueued_before_blocking_executor_can_reorder_waiters(){
    let app=AppHandle::<TestRuntime>(Arc::new(Native{log:Mutex::new(vec![])}),std::marker::PhantomData);
    for action in ["pause","resume","load","abort"]{
    playout_control(tauri::ipc::Invoke{message:tauri::ipc::Message{app:app.clone(),action:action.into()},resolver:tauri::ipc::Resolver,acl:()});
    }
    assert_eq!(*app.0.log.lock().unwrap(),["pause","resume","load","abort"],"controls must enqueue before any response future is polled");
    tauri::ipc::execute_reverse();
    assert_eq!(*app.0.log.lock().unwrap(),["pause","resume","load","abort"],"async response scheduling must not reorder transport intentions");
    }
    '''
    verify("commands", prefix + body + test, directory)

    source = (root / "linux/mod.rs").read_text()
    worker = source[source.index('struct Worker {'):]
    preamble = r'''
    #![allow(dead_code,unused_variables)]
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool,AtomicUsize,Ordering};
    use std::sync::{mpsc,Arc,Mutex};
    use std::time::Duration;
    #[macro_export] macro_rules! json { ($($tt:tt)*) => { () }; }
    mod serde_json { pub(crate) use crate::json; }
    #[derive(Default)] struct PlayoutControlRequest { action:String,path:Option<String>,start:Option<u64>,end:Option<u64>,entry:Option<String>,position_ms:Option<f64>,rate:Option<f64> }
    struct PlayoutControlResponse {session:Option<i32>}
    #[derive(Default)] struct PlayoutPositionResponse {session:i32,index:i32,position_ms:f64,playing:bool,ended_index:Option<i32>}
    mod now_playing {pub fn emit(_: &(),_: &str,_: ()) {}}
    type Listeners=();type Reply=mpsc::SyncSender<Result<PlayoutControlResponse,String>>;
    struct Command{request:PlayoutControlRequest,cancel:Arc<AtomicBool>,reply:Reply}
    struct AudioDecoder {position:f64}
    impl AudioDecoder {
    fn open_with_cancel(_:PathBuf,_:Option<u64>,_:Option<u64>,_:Option<String>,_:Arc<AtomicBool>)->Result<Self,String>{Ok(Self{position:0.0})}
    fn seek(&mut self,seconds:f64)->Result<(),String>{self.position=seconds;Ok(())}
    fn position_seconds(&self)->f64{self.position} fn duration_seconds(&self)->f64{3.0} fn sample_rate(&self)->u32{44100} fn channels(&self)->usize{2}
    fn set_cancel(&mut self,_:Arc<AtomicBool>){} fn next_samples(&mut self)->Result<Option<Vec<f32>>,String>{Ok(None)}
    }
    static NEXT:AtomicUsize=AtomicUsize::new(0);
    static STREAM_EVENTS:Mutex<Vec<String>>=Mutex::new(Vec::new());
    struct Output{id:usize,playing:AtomicBool,position:f64,rate:f64}
    impl Output{
    fn new(_:u32,_:usize,position:f64,rate:f64)->Result<Self,String>{let id=NEXT.fetch_add(1,Ordering::Relaxed);STREAM_EVENTS.lock().unwrap().push(format!("new:{id}"));Ok(Self{id,playing:AtomicBool::new(false),position,rate})}
    fn set_playing(&self,value:bool){self.playing.store(value,Ordering::Relaxed)} fn position(&self)->(f64,bool,bool){(self.position,self.playing.load(Ordering::Relaxed),false)} fn needs_samples(&self)->bool{false}
    fn reset(&mut self,position:f64,rate:f64){self.position=position;self.rate=rate;} fn error(&self)->Option<String>{None} fn push(&mut self,s:&[f32])->usize{s.len()} fn finish(&mut self){} fn pump(&mut self){}
    }
    impl Drop for Output{fn drop(&mut self){STREAM_EVENTS.lock().unwrap().push(format!("drop:{}",self.id));}}
    '''
    tests=r'''
    #[cfg(test)] mod review{use super::*;
    #[test]fn seek_and_rate_replace_device_stream_before_resuming(){
    let mut w=Worker{decoder:None,output:None,pending:vec![],pending_offset:0,session:0,rate:1.0,playing:true,finished:false,listeners:(),position:Arc::new(Mutex::new(PlayoutPositionResponse::default()))};
    let token=Arc::new(AtomicBool::new(false));
    w.control(PlayoutControlRequest{action:"load".into(),path:Some("/audio.m4a".into()),..Default::default()},&token).unwrap();
    for action in ["seek","set-rate"]{
    let old=w.output.as_ref().unwrap().id;STREAM_EVENTS.lock().unwrap().clear();
    w.control(PlayoutControlRequest{action:action.into(),position_ms:Some(1500.0),rate:Some(1.5),..Default::default()},&token).unwrap();
    let output=w.output.as_ref().unwrap();assert_ne!(output.id,old,"{action} must discard the old device buffered audio");
    let events=STREAM_EVENTS.lock().unwrap();assert_eq!(events.first(),Some(&format!("drop:{old}")),"old stream must close before replacement is created");
    assert!(output.playing.load(Ordering::Relaxed));assert_eq!(output.position,1.5);
    }
    }
    }
    '''
    verify("worker", preamble + worker + tests, directory)
