using System.Security.Claims;

namespace DocumentIntelligence.Api;

/// <summary>Shared helpers for reading JWT claims from the authenticated user.</summary>
public static class ClaimsPrincipalExtensions
{
    public const string TenantIdClaim = "tenantId";

    /// <summary>Gets the tenant ID from the "tenantId" claim, or null if missing/invalid.</summary>
    public static Guid? GetTenantId(this ClaimsPrincipal user)
    {
        var value = user?.FindFirst(TenantIdClaim)?.Value;
        return Guid.TryParse(value, out var id) ? id : null;
    }

    /// <summary>Gets the user ID from the "sub" claim, or null if missing/invalid.</summary>
    public static Guid? GetUserId(this ClaimsPrincipal user)
    {
        var value = user?.FindFirst(ClaimTypes.NameIdentifier)?.Value
            ?? user?.FindFirst("sub")?.Value;
        return Guid.TryParse(value, out var id) ? id : null;
    }

    /// <summary>Gets the email claim value.</summary>
    public static string? GetEmail(this ClaimsPrincipal user) =>
        user?.FindFirst(ClaimTypes.Email)?.Value ?? user?.FindFirst("email")?.Value;

    /// <summary>Gets the role claim value.</summary>
    public static string? GetRole(this ClaimsPrincipal user) =>
        user?.FindFirst(ClaimTypes.Role)?.Value ?? user?.FindFirst("role")?.Value;
}
