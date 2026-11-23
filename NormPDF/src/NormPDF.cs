using System;
using System.IO;
using System.Text;
using System.Web.Script.Serialization;
using System.Diagnostics;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Microsoft.Win32;
using System.Linq;

internal static class NormPDF {
    const string HostName = "com.norm.localpdf";
    const int MaxMessageBytes = 2 * 1024 * 1024;
    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = MaxMessageBytes };
    static readonly string Root = Path.GetDirectoryName(System.Reflection.Assembly.GetExecutingAssembly().Location);

    static int Main(string[] args) {
        try {
            if (args.Length > 0 && args[0] == "--render") {
                if (args.Length < 3) throw new ArgumentException("Usage: NormPDF.exe --render input.html output.pdf [conversation|compact|report]");
                string selected = args.Length > 3 ? args[3] : "conversation";
                Render(Path.GetFullPath(args[1]), Path.GetFullPath(args[2]), selected);
                Console.WriteLine("PDF saved: " + Path.GetFullPath(args[2]));
                return 0;
            }
            if (args.Length > 0 && args[0] == "--register") {
                if (args.Length < 2) throw new ArgumentException("Usage: NormPDF.exe --register <32-character Chrome extension ID>");
                Register(args.Skip(1).ToArray());
                Console.WriteLine("Registered Chrome native host: " + HostName);
                return 0;
            }
            if (args.Length > 0 && args[0] == "--ping") {
                Console.WriteLine("NormPDF available; runtime: " + RuntimePath());
                return File.Exists(RuntimePath()) ? 0 : 2;
            }
            return Native();
        } catch (Exception ex) {
            Console.Error.WriteLine("NormPDF: " + ex.Message);
            return 1;
        }
    }

    static string RuntimePath() {
        return Path.Combine(Root, "runtime", "weasyprint", "weasyprint.exe");
    }

    static string Stylesheet(string requested) {
        string kind = requested ?? "conversation";
        if (kind != "conversation" && kind != "compact" && kind != "report") {
            throw new ArgumentException("Unknown PDF template: " + kind);
        }
        string file = Path.Combine(Root, "templates", kind + ".css");
        if (!File.Exists(file)) throw new FileNotFoundException("PDF template not found", file);
        return file;
    }

    static string Q(string text) { return "\"" + text.Replace("\"", "\\\"") + "\""; }

    static void Render(string input, string output, string selected) {
        string exe = RuntimePath();
        if (!File.Exists(exe)) throw new FileNotFoundException("Bundled WeasyPrint runtime is missing", exe);
        if (!File.Exists(input)) throw new FileNotFoundException("HTML input is missing", input);
        string css = Stylesheet(selected);
        Directory.CreateDirectory(Path.GetDirectoryName(output));
        var info = new ProcessStartInfo {
            FileName = exe,
            Arguments = "--stylesheet " + Q(css) + " " + Q(input) + " " + Q(output),
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardError = true, RedirectStandardOutput = true
        };
        using (var process = Process.Start(info)) {
            string error = process.StandardError.ReadToEnd();
            string infoText = process.StandardOutput.ReadToEnd();
            if (!process.WaitForExit(240000)) {
                process.Kill();
                throw new TimeoutException("WeasyPrint exceeded four minutes.");
            }
            if (process.ExitCode != 0) throw new Exception("WeasyPrint failed: " + (error + " " + infoText).Trim());
        }
        using (var file = File.OpenRead(output)) {
            byte[] prefix = new byte[5];
            if (file.Read(prefix, 0, 5) != 5 || Encoding.ASCII.GetString(prefix) != "%PDF-") {
                throw new IOException("Renderer did not produce a valid PDF.");
            }
        }
    }

    static string SafeName(string value) {
        string text = string.IsNullOrWhiteSpace(value) ? "ChatGPT Conversation" : value;
        foreach (char c in Path.GetInvalidFileNameChars()) text = text.Replace(c, ' ');
        text = Regex.Replace(text, @"\s+", " ").Trim(' ', '.');
        return text.Length > 90 ? text.Substring(0, 90) : (text.Length > 0 ? text : "ChatGPT Conversation");
    }

    static void Register(string[] extensionIds) {
        string[] ids = extensionIds.SelectMany(id => id.Split(new char[] {','}, StringSplitOptions.RemoveEmptyEntries))
            .Select(id => id.Trim()).Distinct().ToArray();
        if (ids.Length == 0 || ids.Any(id => !Regex.IsMatch(id, "^[a-p]{32}$"))) {
            throw new ArgumentException("Chrome extension IDs must consist of 32 lowercase a-p characters.");
        }
        var manifest = new Dictionary<string, object> {
            {"name", HostName}, {"description", "Norm portable local PDF renderer"},
            {"path", Path.Combine(Root, "NormPDF.exe")},
            {"type", "stdio"},
            {"allowed_origins", ids.Select(id => "chrome-extension://" + id + "/").ToArray()}
        };
        string file = Path.Combine(Root, "native-host.json");
        File.WriteAllText(file, Json.Serialize(manifest), new UTF8Encoding(false));
        using (var key = Registry.CurrentUser.CreateSubKey(@"Software\Google\Chrome\NativeMessagingHosts\" + HostName)) {
            key.SetValue("", file, RegistryValueKind.String);
        }
    }

    static byte[] ReadExact(Stream stream, int length, bool mayEnd) {
        byte[] bytes = new byte[length];
        int got = 0;
        while (got < length) {
            int n = stream.Read(bytes, got, length - got);
            if (n <= 0) {
                if (got == 0 && mayEnd) return null;
                throw new EndOfStreamException("Incomplete native message.");
            }
            got += n;
        }
        return bytes;
    }

    static Dictionary<string, object> Receive(Stream stream) {
        byte[] header = ReadExact(stream, 4, true);
        if (header == null) return null;
        int length = BitConverter.ToInt32(header, 0);
        if (length <= 0 || length > MaxMessageBytes) throw new IOException("Native message exceeds limit.");
        string raw = Encoding.UTF8.GetString(ReadExact(stream, length, false));
        return Json.Deserialize<Dictionary<string, object>>(raw);
    }

    static string Get(Dictionary<string, object> data, string key, string fallback) {
        object value;
        return data.TryGetValue(key, out value) && value != null ? Convert.ToString(value) : fallback;
    }

    static void Send(Stream output, object data) {
        byte[] bytes = Encoding.UTF8.GetBytes(Json.Serialize(data));
        byte[] prefix = BitConverter.GetBytes(bytes.Length);
        output.Write(prefix, 0, prefix.Length);
        output.Write(bytes, 0, bytes.Length);
        output.Flush();
    }

    static int Native() {
        Stream input = Console.OpenStandardInput(), output = Console.OpenStandardOutput();
        StreamWriter writer = null;
        string temp = null, filename = null, template = "conversation";
        int chunks = 0;
        try {
            while (true) {
                var data = Receive(input);
                if (data == null) break;
                string type = Get(data, "type", "");
                try {
                    if (type == "begin") {
                        if (writer != null) throw new Exception("A PDF transfer is already active.");
                        filename = SafeName(Get(data, "name", "ChatGPT Conversation"));
                        template = Get(data, "template", "conversation");
                        Stylesheet(template);
                        temp = Path.Combine(Path.GetTempPath(), "normpdf-" + Guid.NewGuid().ToString("N") + ".html");
                        writer = new StreamWriter(temp, false, new UTF8Encoding(false), 65536);
                        chunks = 0;
                        Send(output, new {type = "ready", ok = true});
                    } else if (type == "chunk") {
                        if (writer == null) throw new Exception("PDF transfer not started.");
                        int sequence = Convert.ToInt32(Get(data, "seq", "-1"));
                        if (sequence != chunks) throw new Exception("Out-of-order PDF chunk.");
                        writer.Write(Get(data, "text", ""));
                        chunks++;
                        Send(output, new {type = "ack", ok = true, seq = sequence});
                    } else if (type == "finish") {
                        if (writer == null) throw new Exception("PDF transfer not started.");
                        writer.Close(); writer = null;
                        string downloads = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads");
                        Directory.CreateDirectory(downloads);
                        string outputPath = Path.Combine(downloads,
                            filename + " " + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".pdf");
                        Render(temp, outputPath, template);
                        Send(output, new {type = "complete", ok = true, path = outputPath,
                                          bytes = new FileInfo(outputPath).Length, chunks = chunks});
                        return 0;
                    } else {
                        throw new Exception("Unknown PDF action.");
                    }
                } catch (Exception ex) {
                    Send(output, new {type = "error", ok = false, error = ex.Message});
                    return 1;
                }
            }
        } finally {
            if (writer != null) writer.Dispose();
            if (temp != null) { try { File.Delete(temp); } catch {} }
        }
        return 0;
    }
}
