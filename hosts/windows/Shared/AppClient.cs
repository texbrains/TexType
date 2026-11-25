using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Threading.Tasks;

namespace TexType.Shared;

/// <summary>
/// One request to the app on the named pipe <c>\\.\pipe\&lt;pipe_name&gt;-&lt;Windows session id&gt;</c>: connect,
/// <c>hello</c>, the request, its answer. Every message is a 4-byte little-endian length and the UTF-8 JSON.
/// The calls are asynchronous; run them off Office's UI thread.
/// </summary>
public static class AppClient
{
    private const int ConnectTimeoutMs = 2000;

    /// <summary>The answer to <paramref name="request"/>; an error answer is thrown as <see cref="AppErrorException"/>.</summary>
    public static async Task<ResponseBody> SendAsync(Hello hello, RequestBody request)
    {
        using var pipe = new NamedPipeClientStream(".", PipeName(), PipeDirection.InOut, PipeOptions.Asynchronous);
        try
        {
            await pipe.ConnectAsync(ConnectTimeoutMs).ConfigureAwait(false);
        }
        catch (TimeoutException)
        {
            throw new AppNotRunningException();
        }
        var welcome = await ExchangeAsync(pipe, new Request(1, hello)).ConfigureAwait(false);
        if (welcome is not Welcome)
            throw new ProtocolException($"the app answered hello with {welcome.GetType().Name}");
        return await ExchangeAsync(pipe, new Request(2, request)).ConfigureAwait(false);
    }

    private static string PipeName()
    {
        using var process = Process.GetCurrentProcess();
        return $"{Product.PipeName}-{process.SessionId}";
    }

    private static async Task<ResponseBody> ExchangeAsync(Stream pipe, Request request)
    {
        await WriteFrameAsync(pipe, Protocol.Encode(request)).ConfigureAwait(false);
        var response = Protocol.DecodeResponse(await ReadFrameAsync(pipe).ConfigureAwait(false));
        if (response.Id != request.Id)
            throw new ProtocolException($"the app answered request {response.Id} instead of {request.Id}");
        return response.Body is AppError error ? throw new AppErrorException(error.Code, error.Message) : response.Body;
    }

    private static async Task WriteFrameAsync(Stream pipe, byte[] message)
    {
        if (message.Length > Protocol.MaxMessageBytes)
            throw new InvalidOperationException(Texts.MessageTooLarge);
        var frame = new byte[4 + message.Length];
        WriteLength(frame, message.Length);
        Buffer.BlockCopy(message, 0, frame, 4, message.Length);
        await pipe.WriteAsync(frame, 0, frame.Length).ConfigureAwait(false);
        await pipe.FlushAsync().ConfigureAwait(false);
    }

    private static async Task<byte[]> ReadFrameAsync(Stream pipe)
    {
        var header = await ReadExactlyAsync(pipe, 4).ConfigureAwait(false);
        var length = (uint)(header[0] | header[1] << 8 | header[2] << 16 | header[3] << 24);
        if (length > Protocol.MaxMessageBytes)
            throw new ProtocolException($"the app sent a message of {length} bytes; the limit is {Protocol.MaxMessageBytes}");
        return await ReadExactlyAsync(pipe, (int)length).ConfigureAwait(false);
    }

    private static async Task<byte[]> ReadExactlyAsync(Stream pipe, int count)
    {
        var buffer = new byte[count];
        for (var read = 0; read < count;)
        {
            var chunk = await pipe.ReadAsync(buffer, read, count - read).ConfigureAwait(false);
            if (chunk == 0) throw new IOException(Texts.AppClosedConnection);
            read += chunk;
        }
        return buffer;
    }

    private static void WriteLength(byte[] frame, int length)
    {
        frame[0] = (byte)length;
        frame[1] = (byte)(length >> 8);
        frame[2] = (byte)(length >> 16);
        frame[3] = (byte)(length >> 24);
    }
}
