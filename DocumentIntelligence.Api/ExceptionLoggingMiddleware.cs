using Serilog.Context;

namespace DocumentIntelligence.Api;

/// <summary>
/// Catches unhandled exceptions, logs them with correlation ID, and returns a generic 500 response.
/// </summary>
public sealed class ExceptionLoggingMiddleware
{
    private readonly RequestDelegate _next;
    private readonly ILogger<ExceptionLoggingMiddleware> _logger;
    private readonly IHostEnvironment _environment;

    public ExceptionLoggingMiddleware(
        RequestDelegate next,
        ILogger<ExceptionLoggingMiddleware> logger,
        IHostEnvironment environment)
    {
        _next = next;
        _logger = logger;
        _environment = environment;
    }

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await _next(context);
        }
        catch (Exception ex)
        {
            var correlationId = context.Items.TryGetValue(CorrelationIdMiddleware.CorrelationIdItemKey, out var id)
                ? id?.ToString()
                : null;

            using (LogContext.PushProperty("CorrelationId", correlationId))
            {
                _logger.LogError(ex, "Unhandled exception: {Message}", ex.Message);
            }

            if (!context.Response.HasStarted)
            {
                context.Response.StatusCode = StatusCodes.Status500InternalServerError;

                if (_environment.IsDevelopment())
                {
                    await context.Response.WriteAsJsonAsync(new
                    {
                        type = "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                        title = "An error occurred",
                        status = 500,
                        correlationId,
                        detail = ex.ToString()
                    });
                }
                else
                {
                    await context.Response.WriteAsJsonAsync(new
                    {
                        type = "https://tools.ietf.org/html/rfc7231#section-6.6.1",
                        title = "An error occurred",
                        status = 500,
                        correlationId
                    });
                }
            }
            else
            {
                throw;
            }
        }
    }
}
