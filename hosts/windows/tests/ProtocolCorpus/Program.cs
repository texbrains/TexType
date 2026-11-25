using System;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using TexType.Shared;

// The stored messages in testing/corpus/protocol are the contract between the app and the add-ins: every one is read
// through the add-ins' message types and written back to the same JSON (numbers compared by value: 12.0 is 12).
// Usage: ProtocolCorpus <testing/corpus/protocol>. Exits with 1 on the first difference.

if (args.Length != 1)
{
    Console.Error.WriteLine("usage: ProtocolCorpus <testing/corpus/protocol>");
    return 2;
}

var failures = 0;
void Check(string kind, Func<byte[], byte[]> roundTrip)
{
    var files = Directory.GetFiles(Path.Combine(args[0], kind), "*.json").OrderBy(name => name, StringComparer.Ordinal).ToList();
    if (files.Count == 0) throw new InvalidOperationException($"no messages in {kind}");
    foreach (var file in files)
    {
        var stored = File.ReadAllBytes(file);
        string result;
        try
        {
            using var expected = JsonDocument.Parse(stored);
            using var written = JsonDocument.Parse(roundTrip(stored));
            result = Same(expected.RootElement, written.RootElement) ? "ok" : $"written back as {Encoding.UTF8.GetString(roundTrip(stored))}";
        }
        catch (Exception error)
        {
            result = error.Message;
        }
        if (result != "ok") failures++;
        Console.WriteLine($"{kind}/{Path.GetFileName(file)}: {result}");
    }
}

Check("requests", bytes => JsonSerializer.SerializeToUtf8Bytes(
    JsonSerializer.Deserialize<Request>(bytes, Protocol.Json), Protocol.Json));
Check("responses", bytes => JsonSerializer.SerializeToUtf8Bytes(Protocol.DecodeResponse(bytes), Protocol.Json));

// A response that leaves out a field or has null where the protocol has none is refused.
foreach (var broken in new[]
{
    """{"id":4,"body":{"type":"equationEdited","fontSizePt":12.0}}""",
    """{"id":4,"body":{"type":"equationEdited","omml":null,"fontSizePt":12.0}}""",
    """{"id":4,"body":{"type":"formatDisk"}}""",
})
{
    try
    {
        Protocol.DecodeResponse(Encoding.UTF8.GetBytes(broken));
        failures++;
        Console.WriteLine($"accepted: {broken}");
    }
    catch (ProtocolException)
    {
        Console.WriteLine($"refused: {broken}");
    }
}

Console.WriteLine(failures == 0 ? "protocol corpus: ok" : $"protocol corpus: {failures} failure(s)");
return failures == 0 ? 0 : 1;

static bool Same(JsonElement a, JsonElement b) => (a.ValueKind, b.ValueKind) switch
{
    (JsonValueKind.Object, JsonValueKind.Object) =>
        a.EnumerateObject().Count() == b.EnumerateObject().Count()
        && a.EnumerateObject().All(property => b.TryGetProperty(property.Name, out var other) && Same(property.Value, other)),
    (JsonValueKind.Array, JsonValueKind.Array) =>
        a.GetArrayLength() == b.GetArrayLength() && a.EnumerateArray().Zip(b.EnumerateArray(), Same).All(same => same),
    (JsonValueKind.Number, JsonValueKind.Number) => a.GetDecimal() == b.GetDecimal(),
    (JsonValueKind.String, JsonValueKind.String) => a.GetString() == b.GetString(),
    var (x, y) => x == y,
};
