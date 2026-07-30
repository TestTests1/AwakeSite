namespace Awake.Application.Features.Maps;

/// <summary>
/// Props отдаётся сырой строкой JSON: содержимое расстановки интересно только
/// вьюеру, разбирать его на сервере незачем.
/// </summary>
public record MapLayoutDto(
    Guid Id,
    string Location,
    string Name,
    string Props,
    Guid AuthorId,
    string AuthorName,
    DateTime CreatedAt,
    DateTime UpdatedAt);

/// <summary>Список без содержимого: расстановка может весить десятки килобайт.</summary>
public record MapLayoutSummaryDto(
    Guid Id,
    string Location,
    string Name,
    Guid AuthorId,
    string AuthorName,
    int PropCount,
    DateTime UpdatedAt);
