package openai

import (
 "crypto/sha256"
 "testing"
 "time"
 "gemini-web-to-api/internal/commons/configs"
 "gemini-web-to-api/internal/modules/openai/dto"
 "gemini-web-to-api/internal/modules/providers"
 "go.uber.org/zap"
)

func TestReviewRestartQueuedStoreDoesNotDeadlock(t *testing.T) {
 dir:=t.TempDir()
 s,err:=OpenRequestStore(dir,StoreLimits{})
 if err!=nil {t.Fatal(err)}
 _,_,err=s.Admit(sha256.Sum256([]byte("token")),"queued-before-crash",[]byte(`{"model":"gemini-advanced"}`))
 if err!=nil {t.Fatal(err)}
 recovered,err:=OpenRequestStore(dir,StoreLimits{})
 if err!=nil {t.Fatal(err)}
 done:=make(chan struct{})
 go func(){ NewGatewaySchedulerController(&configs.Config{},zap.NewNop(),recovered,nil,nil,nil);close(done) }()
 select {case <-done: case <-time.After(250*time.Millisecond):t.Fatal("constructor deadlocked while recovering a persisted queued operation")}
}

func TestReviewCancelledQueuedOperationCannotRestart(t *testing.T) {
 s,err:=OpenRequestStore(t.TempDir(),StoreLimits{})
 if err!=nil {t.Fatal(err)}
 op,_,err:=s.Admit(sha256.Sum256([]byte("token")),"cancelled",[]byte(`{"model":"gemini-advanced"}`))
 if err!=nil {t.Fatal(err)}
 op.Status="cancelled"
 if err=s.Update(op);err!=nil{t.Fatal(err)}
 c:=NewGatewaySchedulerController(&configs.Config{},zap.NewNop(),s,NewOpenAIService(nil,nil,zap.NewNop()),nil,nil)
 c.executeOperation(op.ID,dto.ChatCompletionRequest{},providers.CookieCredentials{})
 got,err:=s.GetWithoutAuth(op.ID)
 if err!=nil{t.Fatal(err)}
 if got.Status!="cancelled" || got.DispatchState!="not-dispatched" || got.UpstreamAttempts!=0 {t.Fatalf("cancelled operation executed: %+v",got)}
}