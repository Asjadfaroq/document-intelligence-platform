using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;

namespace DocumentIntelligence.Api;

public record RegisterTenantRequest(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword);

public record LoginRequest(
    string TenantSlug,
    string Email,
    string Password);

public record RefreshRequest(string? RefreshToken);

/// <summary>Auth response without tokens (tokens are in HttpOnly cookies).</summary>
public record AuthResponseBody(string TenantId, string Email, string Role);

public static class AuthEndpoints
{
    private const string LogCategory = "DocumentIntelligence.Auth";
    private const string CookieAccess = "di_access";
    private const string CookieRefresh = "di_refresh";
    private const int AccessTokenMaxAgeSeconds = 15 * 60;
    private const int RefreshTokenMaxAgeSeconds = 7 * 24 * 3600;

    private static void SetAuthCookies(HttpContext ctx, AuthResult result)
    {
        var isHttps = ctx.Request.IsHttps;
        var origin = ctx.Request.Headers.Origin.ToString();
        var crossSite = !string.IsNullOrEmpty(origin);
        var cookieOpts = new CookieOptions
        {
            HttpOnly = true,
            Secure = isHttps || crossSite,
            SameSite = crossSite ? SameSiteMode.None : SameSiteMode.Lax,
            Path = "/",
            MaxAge = TimeSpan.FromSeconds(AccessTokenMaxAgeSeconds)
        };
        ctx.Response.Cookies.Append(CookieAccess, result.AccessToken, cookieOpts);
        cookieOpts.MaxAge = TimeSpan.FromSeconds(RefreshTokenMaxAgeSeconds);
        if (!string.IsNullOrEmpty(result.RefreshToken))
            ctx.Response.Cookies.Append(CookieRefresh, result.RefreshToken!, cookieOpts);
    }

    private static IResult OkWithAuthCookies(HttpContext ctx, AuthResult result)
    {
        SetAuthCookies(ctx, result);
        return Results.Ok(new AuthResponseBody(result.TenantId, result.Email, result.Role));
    }

    public static IEndpointRouteBuilder MapAuth(this IEndpointRouteBuilder routes)
    {
        var group = routes.MapGroup("/auth");

        group.MapPost("/register-tenant", async (
            RegisterTenantRequest request,
            HttpContext ctx,
            IMediator mediator,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            try
            {
                var command = new RegisterTenantAndOwnerCommand(
                    request.TenantName,
                    request.TenantSlug,
                    request.OwnerEmail,
                    request.OwnerPassword);
                var result = await mediator.Send(command, ct);
                log.LogInformation(
                    "Tenant registered: TenantSlug={TenantSlug}, OwnerEmail={OwnerEmail}, TenantId={TenantId}",
                    request.TenantSlug, request.OwnerEmail, result.TenantId);
                return OkWithAuthCookies(ctx, result);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Tenant registration failed: TenantSlug={TenantSlug}, Email={Email}", request.TenantSlug, request.OwnerEmail);
                throw;
            }
        });

        group.MapPost("/login", async (
            LoginRequest request,
            HttpContext ctx,
            IMediator mediator,
            IRateLimitService rateLimit,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var clientKey = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            if (!await rateLimit.AllowAsync("login", clientKey, 5, 60, ct))
            {
                log.LogWarning("Login rate limited: Key={Key}", clientKey);
                return Results.Json(new { title = "Too many login attempts. Try again in a minute.", status = 429 }, statusCode: 429);
            }
            try
            {
                var command = new LoginCommand(request.Email, request.Password, request.TenantSlug);
                var result = await mediator.Send(command, ct);
                log.LogInformation(
                    "Login success: TenantSlug={TenantSlug}, Email={Email}, TenantId={TenantId}, Role={Role}",
                    request.TenantSlug, request.Email, result.TenantId, result.Role);
                return OkWithAuthCookies(ctx, result);
            }
            catch (UnauthorizedAccessException)
            {
                log.LogWarning("Login failed (unauthorized): TenantSlug={TenantSlug}, Email={Email}", request.TenantSlug, request.Email);
                return Results.Unauthorized();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Login failed (unexpected): TenantSlug={TenantSlug}, Email={Email}", request.TenantSlug, request.Email);
                return Results.Json(new { title = "Login failed.", status = 500 }, statusCode: 500);
            }
        });

        group.MapPost("/refresh", async (
            RefreshRequest? body,
            HttpContext ctx,
            IMediator mediator,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var refreshToken = body?.RefreshToken?.Trim() ?? ctx.Request.Cookies[CookieRefresh];
            if (string.IsNullOrWhiteSpace(refreshToken))
            {
                log.LogWarning("Refresh called without token");
                return Results.BadRequest("RefreshToken is required.");
            }
            try
            {
                var result = await mediator.Send(new RefreshCommand(refreshToken), ct);
                log.LogInformation("Refresh success: TenantId={TenantId}, Email={Email}", result.TenantId, result.Email);
                return OkWithAuthCookies(ctx, result);
            }
            catch (UnauthorizedAccessException)
            {
                log.LogWarning("Refresh failed (invalid or expired token)");
                return Results.Unauthorized();
            }
        });

        group.MapPost("/logout", async (HttpContext ctx, IRefreshTokenStore refreshStore, ILoggerFactory loggerFactory, CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var refreshToken = ctx.Request.Cookies[CookieRefresh];
            if (!string.IsNullOrWhiteSpace(refreshToken))
            {
                try { await refreshStore.RevokeAsync(refreshToken, ct); } catch { /* best effort */ }
                log.LogInformation("Refresh token revoked on logout");
            }
            var crossSite = !string.IsNullOrEmpty(ctx.Request.Headers.Origin.ToString());
            var opts = new CookieOptions
            {
                Path = "/",
                SameSite = crossSite ? SameSiteMode.None : SameSiteMode.Lax,
                Secure = crossSite || ctx.Request.IsHttps,
                Expires = DateTimeOffset.UtcNow.AddDays(-1)
            };
            ctx.Response.Cookies.Delete(CookieAccess, opts);
            ctx.Response.Cookies.Delete(CookieRefresh, opts);
            return Results.Ok(new { message = "Logged out." });
        });

        group.MapGet("/me", [Authorize] (ClaimsPrincipal user) =>
        {
            var tenantId = user.FindFirst("tenantId")?.Value;
            var email = user.FindFirst(ClaimTypes.Email)?.Value ?? user.FindFirst("email")?.Value;
            var role = user.FindFirst(ClaimTypes.Role)?.Value ?? user.FindFirst("role")?.Value;
            if (string.IsNullOrEmpty(tenantId) || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(role))
                return Results.Unauthorized();
            return Results.Ok(new AuthResponseBody(tenantId, email, role));
        }).RequireAuthorization("TenantUser");

        return routes;
    }
}

