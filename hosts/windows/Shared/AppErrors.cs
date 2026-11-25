using System;

namespace TexType.Shared;

/// <summary>The app's pipe does not exist: the app is not running for this Windows session.</summary>
public sealed class AppNotRunningException() : Exception(Texts.AppNotRunning);

/// <summary>The app answered with an error message.</summary>
public sealed class AppErrorException(ErrorCode code, string message) : Exception(message)
{
    public ErrorCode Code { get; } = code;
}

/// <summary>The app's answer breaks the protocol.</summary>
public sealed class ProtocolException(string message) : Exception(message);
