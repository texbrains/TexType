using System;
using System.Text.Json;

namespace TexType.Shared;

/// <summary>The protocol's version, size limit and JSON form, as core/protocol defines them.</summary>
public static class Protocol
{
    public const uint Version = 1;

    /// <summary>The largest message either side accepts.</summary>
    public const int MaxMessageBytes = 16 * 1024 * 1024;

    /// <summary>camelCase names; a missing field or a null where the protocol has none is refused.</summary>
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        RespectNullableAnnotations = true,
        RespectRequiredConstructorParameters = true,
    };

    public static byte[] Encode(Request request) => JsonSerializer.SerializeToUtf8Bytes(request, Json);

    /// <summary>Reads a response strictly: valid UTF-8 and a known message.</summary>
    public static Response DecodeResponse(byte[] bytes)
    {
        try
        {
            return JsonSerializer.Deserialize<Response>(bytes, Json)
                ?? throw new ProtocolException("the app sent null instead of a response");
        }
        catch (Exception error) when (error is JsonException or NotSupportedException)
        {
            // NotSupportedException: an unknown message type (the abstract body cannot be created).
            throw new ProtocolException($"the app sent a message this add-in does not know: {error.Message}");
        }
    }
}
