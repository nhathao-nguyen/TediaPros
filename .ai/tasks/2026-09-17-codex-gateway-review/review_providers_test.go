package providers

import (
 "context"
 "errors"
 "io"
 "net/http"
 "os"
 "path/filepath"
 "strings"
 "testing"
 "time"
 "gemini-web-to-api/internal/commons/configs"
 "go.uber.org/fx"
 "go.uber.org/zap"
)

type reviewTransport func(*http.Request) (*http.Response, error)
func (f reviewTransport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

func TestReviewProductionFxInjectsGovernor(t *testing.T) {
 g := NewUpstreamGovernor(GovernorPolicy{})
 var c *Client
 var p *ClientPool
 app := fx.New(fx.NopLogger, fx.Supply(&configs.Config{}, zap.NewNop(), g), fx.Provide(NewClient, NewClientPool), fx.Populate(&c, &p))
 if err := app.Err(); err != nil { t.Fatal(err) }
 if c.Governor() != g || p.Governor() != g { t.Fatalf("production constructors missed governor: client=%p pool=%p expected=%p", c.Governor(), p.Governor(), g) }
}

func TestReviewOwnerLockFailsClosed(t *testing.T) {
 dir := t.TempDir()
 owner, err := OpenGovernorStore(dir)
 if err != nil { t.Fatal(err) }
 defer owner.Close()
 cfg := &configs.Config{Governor: configs.GovernorConfig{StateDir:dir}}
 g := NewDefaultGovernor(cfg, zap.NewNop())
 if _, dec := g.TryStart(time.Now()); dec.Allowed { t.Fatal("second instance admitted work despite lock held by first owner") }
}

func reviewClient(t *testing.T, retries int) (*Client, *UpstreamGovernor) {
 t.Helper()
 raw, err := os.ReadFile(filepath.Join("testdata", "model_catalog", "pro_account.json"))
 if err != nil { t.Fatal(err) }
 gov := NewUpstreamGovernor(GovernorPolicy{MinSpacing:time.Nanosecond, InitialCooldown:time.Nanosecond})
 c := NewClient(&configs.Config{}, zap.NewNop(), gov)
 c.at = "offline-test"
 c.maxRetries = retries
 c.fetchCatalogFn = func(context.Context)([]byte,error){return raw,nil}
 return c,gov
}

func TestReviewParseFailureDoesNotLeakPermit(t *testing.T) {
 original := http.DefaultTransport
 defer func(){http.DefaultTransport = original}()
 calls := 0
 http.DefaultTransport = reviewTransport(func(r *http.Request)(*http.Response,error){
  calls++
  return &http.Response{StatusCode:200,Header:make(http.Header),Body:io.NopCloser(strings.NewReader("invalid-body")),Request:r},nil
 })
 c,g := reviewClient(t,2)
 ctx,cancel := context.WithTimeout(context.Background(),1200*time.Millisecond)
 defer cancel()
 _,err := c.GenerateContent(ctx,"offline", WithModel("gemini-advanced"))
 if err == nil {t.Fatal("expected parse failure")}
 if status := g.Status(time.Now()); status.ActivePermits != 0 { t.Fatalf("permit leaked after failed retry: calls=%d state=%s active=%d err=%v", calls,status.State,status.ActivePermits,err) }
}

func TestReviewUnknownTransportDoesNotReplay(t *testing.T) {
 original := http.DefaultTransport
 defer func(){http.DefaultTransport = original}()
 calls := 0
 http.DefaultTransport = reviewTransport(func(r *http.Request)(*http.Response,error){calls++; return nil,errors.New("connection reset by peer after request accepted")})
 c,g := reviewClient(t,2)
 ctx,cancel := context.WithTimeout(context.Background(),3*time.Second)
 defer cancel()
 _,_ = c.GenerateContent(ctx,"offline", WithModel("gemini-advanced"))
 if calls != 1 || g.Status(time.Now()).State != "blocked" {t.Fatalf("unknown result replayed/released: transport calls=%d governor=%+v",calls,g.Status(time.Now()))}
}