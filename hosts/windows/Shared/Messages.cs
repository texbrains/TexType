using System.Text.Json;
using System.Text.Json.Serialization;

namespace TexType.Shared;

// The messages of core/protocol (messages.rs), field for field. The stored messages in testing/corpus/protocol are
// the contract; tests/ProtocolCorpus reads every one of them through these types.

public sealed record Request(ulong Id, RequestBody Body);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(Hello), "hello")]
[JsonDerivedType(typeof(GetSettings), "getSettings")]
[JsonDerivedType(typeof(EditEquation), "editEquation")]
public abstract record RequestBody;

/// <summary>The first message of every connection.</summary>
public sealed record Hello(uint Protocol, Host Host, string HostVersion, string AddinVersion) : RequestBody;

/// <summary>The user's settings.</summary>
public sealed record GetSettings : RequestBody;

/// <summary>
/// Opens the editor for one Word equation: <paramref name="WordOpenXml"/> is the edited equation's range as the host
/// exports it, or null for a new equation; <paramref name="FontSizePt"/> is the edited equation's size, or the text's
/// where a new one goes. Answered when the user inserts it or closes the editor.
/// </summary>
public sealed record EditEquation(string? WordOpenXml, bool Display, string MathFont, double FontSizePt) : RequestBody;

[JsonConverter(typeof(JsonStringEnumConverter<Host>))]
public enum Host
{
    [JsonStringEnumMemberName("word")] Word,
    [JsonStringEnumMemberName("powerpoint")] PowerPoint,
    [JsonStringEnumMemberName("wps-writer")] WpsWriter,
    [JsonStringEnumMemberName("wps-presentation")] WpsPresentation,
}

public sealed record Response(ulong Id, ResponseBody Body);

[JsonPolymorphic(TypeDiscriminatorPropertyName = "type")]
[JsonDerivedType(typeof(Welcome), "welcome")]
[JsonDerivedType(typeof(UserSettings), "settings")]
[JsonDerivedType(typeof(EquationEdited), "equationEdited")]
[JsonDerivedType(typeof(Cancelled), "cancelled")]
[JsonDerivedType(typeof(AppError), "error")]
public abstract record ResponseBody;

public sealed record Welcome(uint Protocol, string AppVersion) : ResponseBody;

/// <summary>The settings are defined in core/settings; the add-ins read none of them yet, so they stay JSON.</summary>
public sealed record UserSettings(JsonElement Settings) : ResponseBody;

/// <summary>The edited equation: one m:oMath to import into the document, and the size the user chose for it.</summary>
public sealed record EquationEdited(string Omml, double FontSizePt) : ResponseBody;

/// <summary>The user closed the editor without inserting.</summary>
public sealed record Cancelled : ResponseBody;

public sealed record AppError(ErrorCode Code, string Message) : ResponseBody;

[JsonConverter(typeof(JsonStringEnumConverter<ErrorCode>))]
public enum ErrorCode
{
    [JsonStringEnumMemberName("protocol-mismatch")] ProtocolMismatch,
    [JsonStringEnumMemberName("bad-request")] BadRequest,
    /// <summary>Another formula is open in the editor; the app brings it to the front.</summary>
    [JsonStringEnumMemberName("busy")] Busy,
    [JsonStringEnumMemberName("unreadable-equation")] UnreadableEquation,
    [JsonStringEnumMemberName("editor-failed")] EditorFailed,
    [JsonStringEnumMemberName("settings-unreadable")] SettingsUnreadable,
}
