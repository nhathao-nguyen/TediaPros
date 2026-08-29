package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const protocol = "whisper-local/1"

type versionEvent struct {
	Type     string   `json:"type"`
	Protocol string   `json:"protocol"`
	Engine   string   `json:"engine"`
	Version  string   `json:"version"`
	Features []string `json:"features"`
}

type request struct {
	Type      string   `json:"type"`
	ID        string   `json:"id"`
	Input     string   `json:"input"`
	Language  string   `json:"language"`
	Task      string   `json:"task"`
	Formats   []string `json:"formats"`
	OutputDir string   `json:"outputDir"`
	Model     string   `json:"model"`
}

type response struct {
	Task     any              `json:"task,omitempty"`
	Language any              `json:"language,omitempty"`
	Duration any              `json:"duration,omitempty"`
	Text     any              `json:"text,omitempty"`
	Segments []map[string]any `json:"segments,omitempty"`
}

type doneEvent struct {
	Type          string   `json:"type"`
	ID            string   `json:"id"`
	Outputs       []string `json:"outputs"`
	AlignmentPath string   `json:"alignmentPath"`
	Effective     string   `json:"effectiveDevice"`
	Response      response `json:"response"`
}

var out = bufio.NewWriter(os.Stdout)

func emit(value any) {
	b, _ := json.Marshal(value)
	_, _ = out.Write(append(b, '\n'))
	_ = out.Flush()
}

func executableNames(name string) []string {
	if strings.HasSuffix(strings.ToLower(name), ".exe") {
		return []string{name}
	}
	return []string{name, name + ".exe"}
}

func sibling(dir string, names ...string) string {
	for _, name := range names {
		for _, candidate := range executableNames(name) {
			path := filepath.Join(dir, candidate)
			if info, err := os.Stat(path); err == nil && !info.IsDir() {
				return path
			}
		}
	}
	return ""
}

func engineDir() string {
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	return filepath.Dir(exe)
}

func cliVersion(cli string) string {
	if cli == "" {
		return ""
	}
	data, err := exec.Command(cli, "--version").CombinedOutput()
	if err != nil {
		return ""
	}
	text := string(data)
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(strings.ToLower(line), "whisper.cpp version:") {
			return strings.TrimSpace(strings.TrimPrefix(strings.ToLower(line), "whisper.cpp version:"))
		}
	}
	return ""
}

func hasCudaRuntime(dir string) bool {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return false
	}
	for _, entry := range entries {
		name := strings.ToLower(entry.Name())
		if strings.Contains(name, "cublas") || strings.Contains(name, "cudart") || strings.Contains(name, "ggml-cuda") {
			return true
		}
	}
	return false
}

func printVersion(cli string) int {
	version := cliVersion(cli)
	if version == "" {
		return 1
	}
	emit(versionEvent{
		Type: "version", Protocol: protocol, Engine: "whisper.cpp", Version: version,
		Features: []string{"daemon", "probe", "word_timestamps", "srt", "vtt", "txt"},
	})
	return 0
}

func printProbe(dir, cli, device string) int {
	version := cliVersion(cli)
	ready := version != ""
	message := ""
	if device == "cuda" && !hasCudaRuntime(dir) {
		ready = false
		message = "Thiếu CUDA runtime của Whisper.cpp."
	}
	if !ready && message == "" {
		message = "Không chạy được whisper.cpp CLI để probe."
	}
	emit(map[string]any{
		"type": "probe", "protocol": protocol, "engine": "whisper.cpp", "device": device,
		"ready": ready, "version": version, "message": message,
	})
	if ready {
		return 0
	}
	return 1
}

func modelID(path string) string {
	name := strings.ToLower(filepath.Base(path))
	for _, id := range []string{"base", "small", "medium"} {
		if strings.Contains(name, id) {
			return id
		}
	}
	return filepath.Base(filepath.Dir(path))
}

func reservePort() (int, error) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port, nil
}

func waitHealth(port int, command *exec.Cmd) error {
	client := &http.Client{Timeout: 2 * time.Second}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if command.ProcessState != nil {
			return errors.New("whisper-server đã thoát khi load model")
		}
		resp, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d/health", port))
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			_ = resp.Body.Close()
			if resp.StatusCode >= 200 && resp.StatusCode < 300 {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return errors.New("whisper-server không sẵn sàng sau 60 giây")
}

func multipartRequest(req request) (*http.Response, error) {
	file, err := os.Open(req.Input)
	if err != nil {
		return nil, err
	}
	defer file.Close()
	var body bytes.Buffer
	writer := multipart.NewWriter(&body)
	part, err := writer.CreateFormFile("file", filepath.Base(req.Input))
	if err != nil {
		return nil, err
	}
	if _, err = io.Copy(part, file); err != nil {
		return nil, err
	}
	_ = writer.WriteField("response_format", "verbose_json")
	_ = writer.WriteField("language", req.Language)
	_ = writer.WriteField("translate", strconv.FormatBool(req.Task == "translate"))
	_ = writer.WriteField("split_on_word", "true")
	if err = writer.Close(); err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest(http.MethodPost, reqURL, &body)
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", writer.FormDataContentType())
	return (&http.Client{}).Do(httpReq)
}

var reqURL string

func expectedOutputs(req request) ([]string, string) {
	base := strings.TrimSuffix(filepath.Base(req.Input), filepath.Ext(req.Input))
	outputs := make([]string, 0, len(req.Formats))
	for _, format := range req.Formats {
		format = strings.TrimPrefix(strings.ToLower(format), ".")
		if format == "srt" || format == "vtt" || format == "txt" || format == "json" {
			outputs = append(outputs, filepath.Join(req.OutputDir, base+"."+format))
		}
	}
	return outputs, filepath.Join(req.OutputDir, base+".alignment.json")
}

func seconds(value any) float64 {
	if number, ok := value.(float64); ok && number >= 0 {
		return number
	}
	return 0
}

func timestamp(value any, decimal byte) string {
	total := int(seconds(value)*1000.0 + 0.5)
	ms := total % 1000
	total /= 1000
	s := total % 60
	total /= 60
	m := total % 60
	h := total / 60
	return fmt.Sprintf("%02d:%02d:%02d%c%03d", h, m, s, decimal, ms)
}

func writeAtomic(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	partial := path + ".partial"
	if err := os.WriteFile(partial, data, 0644); err != nil {
		return err
	}
	// Windows cannot replace an existing destination with Rename. Remove only
	// this exact output path after the new bytes are complete so rerunning a
	// request can safely replace prior SRT/VTT/TXT/alignment artifacts.
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		_ = os.Remove(partial)
		return err
	}
	if err := os.Rename(partial, path); err != nil {
		_ = os.Remove(partial)
		return err
	}
	return nil
}

func writeOutputs(req request, decoded response) ([]string, string, error) {
	if len(decoded.Segments) == 0 {
		return nil, "", errors.New("Whisper.cpp không tạo được cue phụ đề hợp lệ")
	}
	var srt, vtt, txt strings.Builder
	vtt.WriteString("WEBVTT\n\n")
	for index, segment := range decoded.Segments {
		text, _ := segment["text"].(string)
		text = strings.TrimSpace(text)
		if text == "" {
			continue
		}
		start, end := segment["start"], segment["end"]
		if index > 0 {
			txt.WriteString("\n")
		}
		txt.WriteString(text)
		fmt.Fprintf(&srt, "%d\n%s --> %s\n%s\n\n", index+1, timestamp(start, ','), timestamp(end, ','), text)
		fmt.Fprintf(&vtt, "%s --> %s\n%s\n\n", timestamp(start, '.'), timestamp(end, '.'), text)
	}
	if srt.Len() == 0 {
		return nil, "", errors.New("Whisper.cpp không tạo được cue có nội dung")
	}
	outputs, alignment := expectedOutputs(req)
	for _, path := range outputs {
		ext := strings.ToLower(filepath.Ext(path))
		var data []byte
		switch ext {
		case ".srt":
			data = []byte(srt.String())
		case ".vtt":
			data = []byte(vtt.String())
		case ".txt":
			data = []byte(txt.String() + "\n")
		case ".json":
			encoded, err := json.MarshalIndent(decoded, "", "  ")
			if err != nil {
				return nil, "", err
			}
			data = append(encoded, '\n')
		default:
			continue
		}
		if err := writeAtomic(path, data); err != nil {
			return nil, "", err
		}
	}
	alignmentData, err := json.MarshalIndent(map[string]any{"engine": "whisper.cpp", "model": req.Model, "segments": decoded.Segments}, "", "  ")
	if err != nil {
		return nil, "", err
	}
	if err := writeAtomic(alignment, append(alignmentData, '\n')); err != nil {
		return nil, "", err
	}
	return outputs, alignment, nil
}

func daemon(server, model, device string) int {
	port, err := reservePort()
	if err != nil {
		emit(map[string]any{"type": "error", "message": err.Error()})
		return 1
	}
	args := []string{"--model", model, "--host", "127.0.0.1", "--port", strconv.Itoa(port), "--inference-path", "/inference"}
	if device == "cpu" {
		args = append(args, "--no-gpu")
	} else {
		args = append(args, "--dev", "0")
	}
	command := exec.Command(server, args...)
	command.Dir = engineDir()
	if err = command.Start(); err != nil {
		emit(map[string]any{"type": "error", "message": err.Error()})
		return 1
	}
	defer command.Process.Kill()
	reqURL = fmt.Sprintf("http://127.0.0.1:%d/inference", port)
	if err = waitHealth(port, command); err != nil {
		emit(map[string]any{"type": "error", "message": err.Error()})
		return 1
	}
	emit(map[string]any{"type": "ready", "model": modelID(model), "device": device, "effectiveDevice": device, "loadCount": 1})
	scanner := bufio.NewScanner(os.Stdin)
	for scanner.Scan() {
		var req request
		if err := json.Unmarshal(scanner.Bytes(), &req); err != nil || req.Type != "transcribe" {
			emit(map[string]any{"type": "error", "message": "JSON-lines request không hợp lệ"})
			continue
		}
		emit(map[string]any{"type": "progress", "id": req.ID, "percent": 10, "message": "Whisper.cpp đang xử lý local…"})
		resp, err := multipartRequest(req)
		if err != nil {
			emit(map[string]any{"type": "error", "id": req.ID, "message": err.Error()})
			continue
		}
		var decoded response
		if resp.StatusCode < 200 || resp.StatusCode >= 300 {
			data, _ := io.ReadAll(io.LimitReader(resp.Body, 4000))
			_ = resp.Body.Close()
			emit(map[string]any{"type": "error", "id": req.ID, "message": string(data)})
			continue
		}
		err = json.NewDecoder(resp.Body).Decode(&decoded)
		_ = resp.Body.Close()
		if err != nil {
			emit(map[string]any{"type": "error", "id": req.ID, "message": err.Error()})
			continue
		}
		outputs, alignment, err := writeOutputs(req, decoded)
		if err != nil {
			emit(map[string]any{"type": "error", "id": req.ID, "message": err.Error()})
			continue
		}
		emit(map[string]any{"type": "progress", "id": req.ID, "percent": 95, "message": "Đang hoàn tất output local…"})
		emit(doneEvent{Type: "done", ID: req.ID, Outputs: outputs, AlignmentPath: alignment, Effective: device, Response: decoded})
	}
	return 0
}

func main() {
	dir := engineDir()
	cli := sibling(dir, "whisper-cli")
	server := sibling(dir, "whisper-server")
	if len(os.Args) < 2 {
		os.Exit(2)
	}
	switch os.Args[1] {
	case "--version":
		os.Exit(printVersion(cli))
	case "--probe":
		device := "cpu"
		for i := 2; i+1 < len(os.Args); i++ {
			if os.Args[i] == "--device" {
				device = os.Args[i+1]
			}
		}
		if server == "" {
			emit(map[string]any{"type": "probe", "protocol": protocol, "engine": "whisper.cpp", "ready": false, "message": "Thiếu whisper-server."})
			os.Exit(1)
		}
		os.Exit(printProbe(dir, cli, device))
	case "--daemon":
		model, device := "", "cpu"
		for i := 2; i+1 < len(os.Args); i++ {
			if os.Args[i] == "--model" {
				model = os.Args[i+1]
			}
			if os.Args[i] == "--device" {
				device = os.Args[i+1]
			}
		}
		if model == "" || server == "" {
			emit(map[string]any{"type": "error", "message": "Thiếu --model hoặc whisper-server."})
			os.Exit(1)
		}
		os.Exit(daemon(server, model, device))
	default:
		os.Exit(2)
	}
}
