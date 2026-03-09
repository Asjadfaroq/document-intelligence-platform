using System.Security.Claims;
using DocumentIntelligence.Application;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;

namespace DocumentIntelligence.Api;

public record RegisterTenantRequest(
    string TenantName,
    string TenantSlug,
    string OwnerEmail,
    string OwnerPassword);

public record SignupRequest(
    string Email,
    string Password);

public record LoginRequest(
    string TenantSlug,
    string Email,
    string Password);

public record SimpleLoginRequest(
    string Email,
    string Password);

public record RefreshRequest(string? RefreshToken);

/// <summary>Auth response without tokens (tokens are in HttpOnly cookies).</summary>
public record AuthResponseBody(string TenantId, string Email, string Role);

public record AcceptInviteRequest(string Code, string Password);

public record SwitchTenantRequest(string TenantId);

public static class AuthEndpoints
{
    private const string LogCategory = "DocumentIntelligence.Auth";
    private const string CookieAccess = "di_access";
    private const string CookieRefresh = "di_refresh";
    private const int AccessTokenMaxAgeSeconds = 15 * 60;
    private const int RefreshTokenMaxAgeSeconds = 7 * 24 * 3600;

    private static string Slugify(string input)
    {
        if (string.IsNullOrWhiteSpace(input))
            return "workspace";

        var span = input.Trim().ToLowerInvariant().AsSpan();
        var builder = new System.Text.StringBuilder(span.Length);
        var lastWasHyphen = false;

        foreach (var ch in span)
        {
            if (char.IsLetterOrDigit(ch))
            {
                builder.Append(ch);
                lastWasHyphen = false;
            }
            else
            {
                if (!lastWasHyphen)
                {
                    builder.Append('-');
                    lastWasHyphen = true;
                }
            }
        }

        var result = builder.ToString().Trim('-');
        return string.IsNullOrWhiteSpace(result) ? "workspace" : result;
    }

    private static async Task<string> GenerateUniqueTenantSlugAsync(string baseSlug, IApplicationDbContext db, CancellationToken ct)
    {
        var candidate = baseSlug;
        var suffix = 1;
        while (await db.Tenants.AnyAsync(t => t.Slug == candidate, ct))
        {
            suffix++;
            candidate = $"{baseSlug}-{suffix}";
        }

        return candidate;
    }

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

        group.MapPost("/signup", async (
            SignupRequest request,
            HttpContext ctx,
            IMediator mediator,
            IApplicationDbContext db,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var email = request.Email.Trim().ToLowerInvariant();
            if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Password))
            {
                return Results.BadRequest(new { title = "Email and password are required." });
            }

            var localPart = email.Split('@')[0];
            var baseSlug = Slugify($"{localPart}-workspace");
            var tenantSlug = await GenerateUniqueTenantSlugAsync(baseSlug, db, ct);
            var tenantName = $"{localPart}'s Workspace";

            try
            {
                var command = new RegisterTenantAndOwnerCommand(
                    tenantName,
                    tenantSlug,
                    email,
                    request.Password);
                var result = await mediator.Send(command, ct);
                log.LogInformation(
                    "Signup created tenant automatically: TenantSlug={TenantSlug}, Email={Email}, TenantId={TenantId}",
                    tenantSlug, email, result.TenantId);
                return OkWithAuthCookies(ctx, result);
            }
            catch (Exception ex)
            {
                log.LogWarning(ex, "Signup failed: Email={Email}", email);
                throw;
            }
        });

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

        group.MapPost("/login-simple", async (
            SimpleLoginRequest request,
            HttpContext ctx,
            IMediator mediator,
            IApplicationDbContext db,
            IRateLimitService rateLimit,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var clientKey = ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown";
            if (!await rateLimit.AllowAsync("login", clientKey, 5, 60, ct))
            {
                log.LogWarning("Login (simple) rate limited: Key={Key}", clientKey);
                return Results.Json(new { title = "Too many login attempts. Try again in a minute.", status = 429 }, statusCode: 429);
            }

            try
            {
                var email = request.Email.Trim().ToLowerInvariant();
                if (string.IsNullOrWhiteSpace(email) || string.IsNullOrWhiteSpace(request.Password))
                {
                    return Results.BadRequest(new { title = "Email and password are required.", status = 400 });
                }

                var user = await db.Users.FirstOrDefaultAsync(u => u.Email == email, ct);
                if (user is null)
                {
                    log.LogWarning("Login (simple) failed: Email not found. Email={Email}", email);
                    return Results.Unauthorized();
                }

                var tenant = await db.Tenants.FirstOrDefaultAsync(t => t.Id == user.TenantId, ct);
                if (tenant is null)
                {
                    log.LogWarning("Login (simple) failed: Tenant not found for user. Email={Email}, TenantId={TenantId}", email, user.TenantId);
                    return Results.Unauthorized();
                }

                var command = new LoginCommand(email, request.Password, tenant.Slug);
                var result = await mediator.Send(command, ct);
                log.LogInformation(
                    "Login (simple) success: TenantSlug={TenantSlug}, Email={Email}, TenantId={TenantId}, Role={Role}",
                    tenant.Slug, email, result.TenantId, result.Role);
                return OkWithAuthCookies(ctx, result);
            }
            catch (UnauthorizedAccessException)
            {
                log.LogWarning("Login (simple) failed (unauthorized): Email={Email}", request.Email);
                return Results.Unauthorized();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Login (simple) failed (unexpected): Email={Email}", request.Email);
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

        group.MapPost("/accept-invite", async (
            AcceptInviteRequest request,
            HttpContext ctx,
            IMediator mediator,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            try
            {
                var command = new AcceptInviteCommand(request.Code, request.Password);
                var result = await mediator.Send(command, ct);
                log.LogInformation("Invite accepted: Code={Code}, Email={Email}, TenantId={TenantId}", request.Code, result.Email, result.TenantId);
                return OkWithAuthCookies(ctx, result);
            }
            catch (UnauthorizedAccessException)
            {
                log.LogWarning("Accept invite failed (unauthorized): Code={Code}", request.Code);
                return Results.Unauthorized();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Accept invite failed: Code={Code}", request.Code);
                return Results.Json(new { title = "Invite acceptance failed.", status = 500 }, statusCode: 500);
            }
        });

        group.MapGet("/tenants", [Authorize] async (
            ClaimsPrincipal user,
            IMediator mediator,
            CancellationToken ct) =>
        {
            var email = user.GetEmail();
            if (string.IsNullOrWhiteSpace(email))
                return Results.Unauthorized();

            var result = await mediator.Send(new GetUserTenantsQuery(email), ct);
            return Results.Ok(result);
        }).RequireAuthorization("TenantUser");

        group.MapPost("/switch-tenant", [Authorize] async (
            SwitchTenantRequest request,
            ClaimsPrincipal user,
            HttpContext ctx,
            IMediator mediator,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var log = loggerFactory.CreateLogger(LogCategory);
            var email = user.GetEmail();
            if (string.IsNullOrWhiteSpace(email))
                return Results.Unauthorized();

            if (!Guid.TryParse(request.TenantId, out var tenantId))
                return Results.BadRequest(new { title = "Invalid tenantId.", status = 400 });

            try
            {
                var command = new SwitchTenantCommand(tenantId, email);
                var result = await mediator.Send(command, ct);
                log.LogInformation("Tenant switched: Email={Email}, TenantId={TenantId}, Role={Role}", result.Email, result.TenantId, result.Role);
                return OkWithAuthCookies(ctx, result);
            }
            catch (UnauthorizedAccessException)
            {
                log.LogWarning("Tenant switch failed (unauthorized): Email={Email}, TenantId={TenantId}", email, request.TenantId);
                return Results.Unauthorized();
            }
            catch (Exception ex)
            {
                log.LogError(ex, "Tenant switch failed (unexpected): Email={Email}, TenantId={TenantId}", email, request.TenantId);
                return Results.Json(new { title = "Tenant switch failed.", status = 500 }, statusCode: 500);
            }
        }).RequireAuthorization("TenantUser");

        group.MapGet("/me", [Authorize] (ClaimsPrincipal user) =>
        {
            var tenantId = user.GetTenantId();
            var email = user.GetEmail();
            var role = user.GetRole();
            if (tenantId == null || string.IsNullOrEmpty(email) || string.IsNullOrEmpty(role))
                return Results.Unauthorized();
            return Results.Ok(new AuthResponseBody(tenantId.Value.ToString(), email, role));
        }).RequireAuthorization("TenantUser");

        return routes;
    }
}

